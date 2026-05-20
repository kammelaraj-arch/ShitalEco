"""Reporting suite (Phase 5).

All reports read from the GL (transactions + transaction_lines) joined
to nominal_codes. No duplicated reporting tables.

Endpoints
    GET /admin/reports/income-expense          — I&E by period/branch/fund/project
    GET /admin/reports/balance-sheet           — A/L/E snapshot at a date
    GET /admin/reports/sofa                    — UK SORP Statement of
                                                  Financial Activities by
                                                  fund-type column
    GET /admin/reports/branch-pl               — per-branch P&L summary
    GET /admin/reports/income-expense.csv      — CSV export of I&E
    GET /admin/reports/balance-sheet.csv       — CSV export of Balance Sheet
    GET /admin/reports/sofa.csv                — CSV export of SoFA
    GET /admin/reports/branch-pl.csv           — CSV export of branch P&L

All CSV endpoints accept the same query params as the JSON endpoint;
they return text/csv with a sensible filename.
"""
from __future__ import annotations

import csv
import io
from datetime import UTC, date, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Response

from shital.api.deps import CurrentSpace

router = APIRouter(tags=["reports"])

PRIVILEGED = {"SUPER_ADMIN", "ADMIN", "ACCOUNTANT", "AUDITOR"}


def _require(ctx: CurrentSpace) -> None:
    if (getattr(ctx, "role", "") or "").upper() not in PRIVILEGED:
        raise HTTPException(403, detail="Privileged role required")


def _csv_response(filename: str, rows: list[list[Any]]) -> Response:
    buf = io.StringIO()
    w = csv.writer(buf)
    for r in rows:
        w.writerow(r)
    return Response(
        content=buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _period_defaults(from_date: str, to_date: str) -> tuple[date, date]:
    today = datetime.now(UTC).date()
    fd = date.fromisoformat(from_date) if from_date else today.replace(month=1, day=1)
    td = date.fromisoformat(to_date) if to_date else today
    return fd, td


# ─── Income & Expenditure ───────────────────────────────────────────────────

async def _income_expense_rows(
    branch_id: str, fund_type: str, project_id: str,
    from_date: str, to_date: str,
) -> dict[str, Any]:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    fd, td = _period_defaults(from_date, to_date)
    where: list[str] = [
        "t.status = 'POSTED'", "t.deleted_at IS NULL",
        "nc.type IN ('INCOME', 'EXPENSE')",
        "t.date BETWEEN :fd AND :td",
    ]
    params: dict[str, Any] = {"fd": fd, "td": td}
    if branch_id.strip():
        where.append("tl.branch_id = :bid")
        params["bid"] = branch_id.strip()
    if fund_type.strip():
        where.append("tl.fund_type = :ft")
        params["ft"] = fund_type.strip().upper()
    if project_id.strip():
        where.append("tl.project_id = :pid")
        params["pid"] = project_id.strip()
    sql_where = " AND ".join(where)

    async with SessionLocal() as db:
        rows = (await db.execute(text(f"""
            SELECT nc.code, nc.name, nc.type, nc.category, nc.subcategory,
                   COALESCE(SUM(CASE WHEN nc.type = 'INCOME'  THEN tl.credit_amount - tl.debit_amount ELSE 0 END), 0) AS income_amt,
                   COALESCE(SUM(CASE WHEN nc.type = 'EXPENSE' THEN tl.debit_amount - tl.credit_amount  ELSE 0 END), 0) AS expense_amt
            FROM   transaction_lines tl
            JOIN   nominal_codes nc ON nc.id = tl.nominal_code_id
            JOIN   transactions  t  ON t.id  = tl.transaction_id
            WHERE  {sql_where}
            GROUP  BY nc.code, nc.name, nc.type, nc.category, nc.subcategory
            ORDER  BY nc.type DESC, nc.code
        """), params)).mappings().all()

    income: list[dict[str, Any]] = []
    expense: list[dict[str, Any]] = []
    total_income = 0.0
    total_expense = 0.0
    for r in rows:
        if r["type"] == "INCOME":
            amt = float(r["income_amt"] or 0)
            if amt == 0:
                continue
            total_income += amt
            income.append({"code": r["code"], "name": r["name"],
                           "category": r["category"], "amount": round(amt, 2)})
        else:
            amt = float(r["expense_amt"] or 0)
            if amt == 0:
                continue
            total_expense += amt
            expense.append({"code": r["code"], "name": r["name"],
                            "category": r["category"], "amount": round(amt, 2)})

    return {
        "filters": {
            "branch_id":  branch_id, "fund_type": fund_type,
            "project_id": project_id,
            "from_date":  fd.isoformat(), "to_date": td.isoformat(),
        },
        "income":  income,
        "expense": expense,
        "total_income":  round(total_income, 2),
        "total_expense": round(total_expense, 2),
        "surplus_deficit": round(total_income - total_expense, 2),
    }


@router.get("/admin/reports/income-expense")
async def income_expense(
    ctx: CurrentSpace,
    branch_id: str = "",
    fund_type: str = "",
    project_id: str = "",
    from_date: str = "",
    to_date: str = "",
) -> dict[str, Any]:
    _require(ctx)
    return await _income_expense_rows(branch_id, fund_type, project_id, from_date, to_date)


@router.get("/admin/reports/income-expense.csv")
async def income_expense_csv(
    ctx: CurrentSpace,
    branch_id: str = "",
    fund_type: str = "",
    project_id: str = "",
    from_date: str = "",
    to_date: str = "",
) -> Response:
    _require(ctx)
    d = await _income_expense_rows(branch_id, fund_type, project_id, from_date, to_date)
    rows: list[list[Any]] = [
        ["SHITAL — Income & Expenditure Report"],
        ["Period", f"{d['filters']['from_date']} to {d['filters']['to_date']}"],
        ["Branch", d["filters"]["branch_id"] or "ALL"],
        ["Fund",   d["filters"]["fund_type"] or "ALL"],
        [],
        ["INCOME"],
        ["Code", "Name", "Category", "Amount (GBP)"],
    ]
    for i in d["income"]:
        rows.append([i["code"], i["name"], i["category"], f"{i['amount']:.2f}"])
    rows += [
        ["", "", "Total income", f"{d['total_income']:.2f}"],
        [],
        ["EXPENSE"],
        ["Code", "Name", "Category", "Amount (GBP)"],
    ]
    for e in d["expense"]:
        rows.append([e["code"], e["name"], e["category"], f"{e['amount']:.2f}"])
    rows += [
        ["", "", "Total expense", f"{d['total_expense']:.2f}"],
        [],
        ["", "", "Surplus / (Deficit)", f"{d['surplus_deficit']:.2f}"],
    ]
    return _csv_response(f"income-expense-{d['filters']['from_date']}-to-{d['filters']['to_date']}.csv", rows)


# ─── Balance Sheet ──────────────────────────────────────────────────────────

async def _balance_sheet_rows(as_at: str, branch_id: str) -> dict[str, Any]:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    target = date.fromisoformat(as_at) if as_at else datetime.now(UTC).date()
    where = [
        "t.status = 'POSTED'", "t.deleted_at IS NULL",
        "t.date <= :td", "nc.type IN ('ASSET', 'LIABILITY', 'EQUITY')",
    ]
    params: dict[str, Any] = {"td": target}
    if branch_id.strip():
        where.append("tl.branch_id = :bid")
        params["bid"] = branch_id.strip()
    sql_where = " AND ".join(where)

    async with SessionLocal() as db:
        rows = (await db.execute(text(f"""
            SELECT nc.code, nc.name, nc.type, nc.category,
                   COALESCE(SUM(tl.debit_amount),  0) AS dr,
                   COALESCE(SUM(tl.credit_amount), 0) AS cr
            FROM   transaction_lines tl
            JOIN   nominal_codes nc ON nc.id = tl.nominal_code_id
            JOIN   transactions  t  ON t.id  = tl.transaction_id
            WHERE  {sql_where}
            GROUP  BY nc.code, nc.name, nc.type, nc.category
            ORDER  BY nc.type, nc.code
        """), params)).mappings().all()

        # Retained earnings (income - expenses to date) goes under Equity
        retained = (await db.execute(text(f"""
            SELECT COALESCE(SUM(CASE WHEN nc.type='INCOME'  THEN tl.credit_amount - tl.debit_amount ELSE 0 END), 0) AS income,
                   COALESCE(SUM(CASE WHEN nc.type='EXPENSE' THEN tl.debit_amount  - tl.credit_amount ELSE 0 END), 0) AS expense
            FROM   transaction_lines tl
            JOIN   nominal_codes nc ON nc.id = tl.nominal_code_id
            JOIN   transactions  t  ON t.id  = tl.transaction_id
            WHERE  t.status='POSTED' AND t.deleted_at IS NULL AND t.date <= :td
              {' AND tl.branch_id = :bid' if branch_id.strip() else ''}
        """), params)).mappings().first()

    assets: list[dict[str, Any]] = []
    liabilities: list[dict[str, Any]] = []
    equity: list[dict[str, Any]] = []
    total_assets = 0.0
    total_liabilities = 0.0
    total_equity = 0.0

    for r in rows:
        dr = float(r["dr"] or 0)
        cr = float(r["cr"] or 0)
        if r["type"] == "ASSET":
            bal = round(dr - cr, 2)
            if bal == 0:
                continue
            total_assets += bal
            assets.append({"code": r["code"], "name": r["name"],
                           "category": r["category"], "balance": bal})
        elif r["type"] == "LIABILITY":
            bal = round(cr - dr, 2)
            if bal == 0:
                continue
            total_liabilities += bal
            liabilities.append({"code": r["code"], "name": r["name"],
                                "category": r["category"], "balance": bal})
        else:  # EQUITY
            bal = round(cr - dr, 2)
            if bal == 0:
                continue
            total_equity += bal
            equity.append({"code": r["code"], "name": r["name"],
                           "category": r["category"], "balance": bal})

    retained_earnings = round(
        float(retained["income"] or 0) - float(retained["expense"] or 0), 2,
    ) if retained else 0.0
    if retained_earnings != 0:
        equity.append({
            "code": "RE", "name": "Retained surplus / (deficit)",
            "category": "FUNDS", "balance": retained_earnings,
        })
        total_equity += retained_earnings

    return {
        "as_at":             target.isoformat(),
        "branch_id":         branch_id,
        "assets":            assets,
        "liabilities":       liabilities,
        "equity":            equity,
        "total_assets":      round(total_assets, 2),
        "total_liabilities": round(total_liabilities, 2),
        "total_equity":      round(total_equity, 2),
        "is_balanced":       abs(total_assets - (total_liabilities + total_equity)) < 0.01,
    }


@router.get("/admin/reports/balance-sheet")
async def balance_sheet(ctx: CurrentSpace, as_at: str = "", branch_id: str = "") -> dict[str, Any]:
    _require(ctx)
    return await _balance_sheet_rows(as_at, branch_id)


@router.get("/admin/reports/balance-sheet.csv")
async def balance_sheet_csv(ctx: CurrentSpace, as_at: str = "", branch_id: str = "") -> Response:
    _require(ctx)
    d = await _balance_sheet_rows(as_at, branch_id)
    rows: list[list[Any]] = [
        ["SHITAL — Balance Sheet"],
        ["As at", d["as_at"]],
        ["Branch", d["branch_id"] or "ALL"],
        [],
        ["ASSETS"],
        ["Code", "Name", "Category", "Balance (GBP)"],
    ]
    for a in d["assets"]:
        rows.append([a["code"], a["name"], a["category"], f"{a['balance']:.2f}"])
    rows += [["", "", "Total Assets", f"{d['total_assets']:.2f}"], [],
             ["LIABILITIES"], ["Code", "Name", "Category", "Balance (GBP)"]]
    for li in d["liabilities"]:
        rows.append([li["code"], li["name"], li["category"], f"{li['balance']:.2f}"])
    rows += [["", "", "Total Liabilities", f"{d['total_liabilities']:.2f}"], [],
             ["EQUITY / FUNDS"], ["Code", "Name", "Category", "Balance (GBP)"]]
    for eq in d["equity"]:
        rows.append([eq["code"], eq["name"], eq["category"], f"{eq['balance']:.2f}"])
    rows += [["", "", "Total Equity", f"{d['total_equity']:.2f}"], [],
             ["", "", "Liabilities + Equity",
              f"{d['total_liabilities'] + d['total_equity']:.2f}"],
             ["", "", "Difference (should be 0)",
              f"{(d['total_assets'] - d['total_liabilities'] - d['total_equity']):.2f}"]]
    return _csv_response(f"balance-sheet-{d['as_at']}.csv", rows)


# ─── SoFA (Statement of Financial Activities) ───────────────────────────────

async def _sofa_rows(branch_id: str, from_date: str, to_date: str) -> dict[str, Any]:
    """UK SORP SoFA layout — income + expenditure split by fund_type column."""
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    fd, td = _period_defaults(from_date, to_date)
    where = [
        "t.status = 'POSTED'", "t.deleted_at IS NULL",
        "t.date BETWEEN :fd AND :td",
        "nc.type IN ('INCOME', 'EXPENSE')",
    ]
    params: dict[str, Any] = {"fd": fd, "td": td}
    if branch_id.strip():
        where.append("tl.branch_id = :bid")
        params["bid"] = branch_id.strip()
    sql_where = " AND ".join(where)

    async with SessionLocal() as db:
        rows = (await db.execute(text(f"""
            SELECT nc.code, nc.name, nc.type, nc.category, nc.activity_type,
                   tl.fund_type,
                   COALESCE(SUM(
                       CASE WHEN nc.type='INCOME'  THEN tl.credit_amount - tl.debit_amount
                            ELSE                       tl.debit_amount  - tl.credit_amount END
                   ), 0) AS amount
            FROM   transaction_lines tl
            JOIN   nominal_codes nc ON nc.id = tl.nominal_code_id
            JOIN   transactions  t  ON t.id  = tl.transaction_id
            WHERE  {sql_where}
            GROUP  BY nc.code, nc.name, nc.type, nc.category, nc.activity_type, tl.fund_type
            ORDER  BY nc.type DESC, nc.code, tl.fund_type
        """), params)).mappings().all()

    funds = ["UNRESTRICTED", "RESTRICTED", "ENDOWMENT"]
    items: dict[tuple[str, str, str], dict[str, Any]] = {}
    for r in rows:
        amt = float(r["amount"] or 0)
        if amt == 0:
            continue
        key = (r["type"], r["code"], r["name"])
        cell = items.setdefault(key, {
            "type": r["type"], "code": r["code"], "name": r["name"],
            "category": r["category"], "activity_type": r["activity_type"],
            "UNRESTRICTED": 0.0, "RESTRICTED": 0.0, "ENDOWMENT": 0.0, "TOTAL": 0.0,
        })
        fund = r["fund_type"] if r["fund_type"] in funds else "UNRESTRICTED"
        cell[fund] = round(cell[fund] + amt, 2)
        cell["TOTAL"] = round(cell["TOTAL"] + amt, 2)

    incoming = [v for v in items.values() if v["type"] == "INCOME"]
    spent    = [v for v in items.values() if v["type"] == "EXPENSE"]

    def _sum(rows_: list[dict[str, Any]], col: str) -> float:
        return round(sum(r[col] for r in rows_), 2)

    totals_in = {f: _sum(incoming, f) for f in (*funds, "TOTAL")}
    totals_ex = {f: _sum(spent,    f) for f in (*funds, "TOTAL")}
    net = {f: round(totals_in[f] - totals_ex[f], 2) for f in (*funds, "TOTAL")}

    return {
        "filters":  {"branch_id": branch_id, "from_date": fd.isoformat(), "to_date": td.isoformat()},
        "incoming": incoming,
        "spent":    spent,
        "totals_in":      totals_in,
        "totals_ex":      totals_ex,
        "net_movement":   net,
    }


@router.get("/admin/reports/sofa")
async def sofa(ctx: CurrentSpace, branch_id: str = "",
               from_date: str = "", to_date: str = "") -> dict[str, Any]:
    _require(ctx)
    return await _sofa_rows(branch_id, from_date, to_date)


@router.get("/admin/reports/sofa.csv")
async def sofa_csv(ctx: CurrentSpace, branch_id: str = "",
                   from_date: str = "", to_date: str = "") -> Response:
    _require(ctx)
    d = await _sofa_rows(branch_id, from_date, to_date)
    rows: list[list[Any]] = [
        ["SHITAL — Statement of Financial Activities (SoFA)"],
        ["Period", f"{d['filters']['from_date']} to {d['filters']['to_date']}"],
        ["Branch", d["filters"]["branch_id"] or "ALL"],
        [],
        ["INCOMING RESOURCES"],
        ["Code", "Name", "Activity", "Unrestricted", "Restricted", "Endowment", "Total"],
    ]
    for r in d["incoming"]:
        rows.append([r["code"], r["name"], r["activity_type"],
                     f"{r['UNRESTRICTED']:.2f}", f"{r['RESTRICTED']:.2f}",
                     f"{r['ENDOWMENT']:.2f}",   f"{r['TOTAL']:.2f}"])
    t = d["totals_in"]
    rows.append(["", "Total incoming", "",
                 f"{t['UNRESTRICTED']:.2f}", f"{t['RESTRICTED']:.2f}",
                 f"{t['ENDOWMENT']:.2f}",    f"{t['TOTAL']:.2f}"])
    rows += [[], ["RESOURCES EXPENDED"],
             ["Code", "Name", "Activity", "Unrestricted", "Restricted", "Endowment", "Total"]]
    for r in d["spent"]:
        rows.append([r["code"], r["name"], r["activity_type"],
                     f"{r['UNRESTRICTED']:.2f}", f"{r['RESTRICTED']:.2f}",
                     f"{r['ENDOWMENT']:.2f}",   f"{r['TOTAL']:.2f}"])
    t = d["totals_ex"]
    rows.append(["", "Total expended", "",
                 f"{t['UNRESTRICTED']:.2f}", f"{t['RESTRICTED']:.2f}",
                 f"{t['ENDOWMENT']:.2f}",    f"{t['TOTAL']:.2f}"])
    n = d["net_movement"]
    rows.append(["", "Net movement in funds", "",
                 f"{n['UNRESTRICTED']:.2f}", f"{n['RESTRICTED']:.2f}",
                 f"{n['ENDOWMENT']:.2f}",    f"{n['TOTAL']:.2f}"])
    return _csv_response(f"sofa-{d['filters']['from_date']}-to-{d['filters']['to_date']}.csv", rows)


# ─── Branch P&L ─────────────────────────────────────────────────────────────

async def _branch_pl_rows(from_date: str, to_date: str, fund_type: str) -> dict[str, Any]:
    from sqlalchemy import text

    from shital.core.fabrics.database import SessionLocal

    fd, td = _period_defaults(from_date, to_date)
    where = [
        "t.status='POSTED'", "t.deleted_at IS NULL",
        "t.date BETWEEN :fd AND :td",
        "nc.type IN ('INCOME','EXPENSE')",
    ]
    params: dict[str, Any] = {"fd": fd, "td": td}
    if fund_type.strip():
        where.append("tl.fund_type = :ft")
        params["ft"] = fund_type.strip().upper()
    sql_where = " AND ".join(where)
    async with SessionLocal() as db:
        rows = (await db.execute(text(f"""
            SELECT tl.branch_id,
                   COALESCE(SUM(CASE WHEN nc.type='INCOME'  THEN tl.credit_amount - tl.debit_amount ELSE 0 END), 0) AS income,
                   COALESCE(SUM(CASE WHEN nc.type='EXPENSE' THEN tl.debit_amount  - tl.credit_amount ELSE 0 END), 0) AS expense
            FROM   transaction_lines tl
            JOIN   nominal_codes nc ON nc.id = tl.nominal_code_id
            JOIN   transactions  t  ON t.id  = tl.transaction_id
            WHERE  {sql_where}
            GROUP  BY tl.branch_id
            ORDER  BY tl.branch_id
        """), params)).mappings().all()

    items = []
    sum_in = 0.0
    sum_ex = 0.0
    for r in rows:
        income = float(r["income"] or 0)
        expense = float(r["expense"] or 0)
        sum_in += income
        sum_ex += expense
        items.append({
            "branch_id": r["branch_id"],
            "income":    round(income, 2),
            "expense":   round(expense, 2),
            "net":       round(income - expense, 2),
        })
    return {
        "filters":      {"from_date": fd.isoformat(), "to_date": td.isoformat(), "fund_type": fund_type},
        "items":        items,
        "total_income": round(sum_in, 2),
        "total_expense": round(sum_ex, 2),
        "total_net":    round(sum_in - sum_ex, 2),
    }


@router.get("/admin/reports/branch-pl")
async def branch_pl(ctx: CurrentSpace, from_date: str = "", to_date: str = "",
                    fund_type: str = "") -> dict[str, Any]:
    _require(ctx)
    return await _branch_pl_rows(from_date, to_date, fund_type)


@router.get("/admin/reports/branch-pl.csv")
async def branch_pl_csv(ctx: CurrentSpace, from_date: str = "", to_date: str = "",
                        fund_type: str = "") -> Response:
    _require(ctx)
    d = await _branch_pl_rows(from_date, to_date, fund_type)
    rows: list[list[Any]] = [
        ["SHITAL — Branch P&L Summary"],
        ["Period", f"{d['filters']['from_date']} to {d['filters']['to_date']}"],
        ["Fund",   d["filters"]["fund_type"] or "ALL"],
        [],
        ["Branch", "Income (GBP)", "Expense (GBP)", "Net (GBP)"],
    ]
    for it in d["items"]:
        rows.append([it["branch_id"], f"{it['income']:.2f}", f"{it['expense']:.2f}", f"{it['net']:.2f}"])
    rows.append(["TOTAL", f"{d['total_income']:.2f}", f"{d['total_expense']:.2f}", f"{d['total_net']:.2f}"])
    return _csv_response(f"branch-pl-{d['filters']['from_date']}-to-{d['filters']['to_date']}.csv", rows)
