"""Payroll router."""
from fastapi import APIRouter
from shital.api.deps import CurrentSpace
from shital.capabilities.payroll.capabilities import (
    calculate_payslip, run_payroll,
    PayslipCalculationInput, RunPayrollInput,
)

router = APIRouter(prefix="/payroll", tags=["payroll"])


@router.post("/calculate")
async def calc_payslip(body: PayslipCalculationInput, ctx: CurrentSpace):
    return await calculate_payslip(ctx, body)


@router.post("/run")
async def run(body: RunPayrollInput, ctx: CurrentSpace):
    return await run_payroll(ctx, body)


@router.get("/runs")
async def list_runs(ctx: CurrentSpace):
    from shital.core.fabrics.database import SessionLocal
    from sqlalchemy import text
    async with SessionLocal() as db:
        result = await db.execute(
            text("""
                SELECT id, period, run_date, status, total_gross, total_net, total_tax
                FROM payroll_runs
                WHERE branch_id = :bid AND deleted_at IS NULL
                ORDER BY run_date DESC LIMIT 24
            """),
            {"bid": ctx.branch_id},
        )
        return {"runs": [dict(r) for r in result.mappings()]}
