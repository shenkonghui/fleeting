const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  getMemos:       (opts)      => ipcRenderer.invoke('get-memos', opts),
  getMonths:      ()          => ipcRenderer.invoke('get-months'),
  addMemo:        (opts)      => ipcRenderer.invoke('add-memo', opts),
  deleteMemo:     (opts)      => ipcRenderer.invoke('delete-memo', opts),
  searchMemos:    (opts)      => ipcRenderer.invoke('search-memos', opts),
  getTags:        (isPrivate) => ipcRenderer.invoke('get-tags', isPrivate),
  editMemo:       (opts)      => ipcRenderer.invoke('edit-memo', opts),
  getHistory:     (timestamp) => ipcRenderer.invoke('get-history', timestamp),
  saveImage:      (info)      => ipcRenderer.invoke('save-image', info),
  openStorageDir: ()          => ipcRenderer.invoke('open-storage-dir'),
  getGlobalConfig:()          => ipcRenderer.invoke('get-global-config'),
  setGlobalConfig:(cfg)       => ipcRenderer.invoke('set-global-config', cfg),
  selectDirectory:()          => ipcRenderer.invoke('select-directory'),
  verifyPrivatePassword: (pwd) => ipcRenderer.invoke('verify-private-password', pwd),
  getBackupConfig:()          => ipcRenderer.invoke('get-backup-config'),
  setBackupConfig:(cfg)       => ipcRenderer.invoke('set-backup-config', cfg),
  listBackups:()              => ipcRenderer.invoke('list-backups'),
  runBackupNow:()             => ipcRenderer.invoke('run-backup-now'),
  deleteBackup:(id)           => ipcRenderer.invoke('delete-backup', id),
  restoreBackup:(id)          => ipcRenderer.invoke('restore-backup', id),
})
