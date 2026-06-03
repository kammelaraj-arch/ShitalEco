const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')

let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({
    fullscreen: true,
    kiosk: true,          // Locks to full-screen, no taskbar
    frame: false,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
    backgroundColor: '#1a0a00',
  })

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    // Load the live web kiosk so the installed app stays in sync with
    // shital.org.uk/kiosk/ — no reinstall needed for UI changes, image URLs
    // returned by the API resolve naturally, and there are no CORS hops.
    // The bundled dist/ is no longer used in production builds.
    mainWindow.loadURL('https://shital.org.uk/kiosk/')
  }

  // Prevent navigation away from kiosk
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('http://localhost') && !url.includes('shital.org')) {
      event.preventDefault()
    }
  })
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// IPC for printer (receipt printing)
ipcMain.handle('print-receipt', async (event, content) => {
  const win = BrowserWindow.getFocusedWindow()
  if (win) {
    win.webContents.print({ silent: true, printBackground: true })
    return { success: true }
  }
  return { success: false }
})
