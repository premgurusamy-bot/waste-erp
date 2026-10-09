const { contextBridge, ipcRenderer } = require("electron");

// Used by the ERP pages (Backup & Restore -> OPEN BACKUP FOLDER)
contextBridge.exposeInMainWorld("grlDesktop", {
  openPath: (which) => ipcRenderer.invoke("grl:open-path", which),
  backupDir: () => ipcRenderer.invoke("grl:backup-dir"),
});

// Used only by setup.html (first run)
contextBridge.exposeInMainWorld("grlSetup", {
  test: (cfg) => ipcRenderer.invoke("grl:setup-test", cfg),
  save: (cfg) => ipcRenderer.invoke("grl:setup-save", cfg),
  info: () => ipcRenderer.invoke("grl:setup-info"),
});
