// Shital Admin — desktop wrapper. A thin Electron shell that live-loads the
// production admin panel (https://admin.shital.org.uk/) in a normal resizable
// window, so the installed app always runs the latest admin UI without a
// reinstall. Mirrors the Kiosk desktop pattern, minus the kiosk lockdown.
const { app, BrowserWindow, shell, Menu } = require('electron')

const ADMIN_URL = process.env.ADMIN_LIVE_URL || 'https://admin.shital.org.uk/'

let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#0B0B0F',
    autoHideMenuBar: true,
    title: 'Shital Admin',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  mainWindow.loadURL(ADMIN_URL)

  // Keep the app on the Shital domains; open anything else (external links,
  // PayPal, docs) in the user's default browser.
  const isInternal = (url) => url.includes('shital.org') || url.startsWith('about:')
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!isInternal(url)) { shell.openExternal(url); return { action: 'deny' } }
    return { action: 'allow' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isInternal(url)) { event.preventDefault(); shell.openExternal(url) }
  })
}

app.whenReady().then(() => {
  // Minimal menu: keep standard edit/reload/zoom shortcuts, drop the noise.
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]))
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
