/** Temporisation du téléchargement de l'historique VMI. */
export function armDownloadTimeout(download, finishDownload, delay = 20000) {
  clearTimeout(download.timeout);
  download.timeout = setTimeout(() => {
    if (download.on) finishDownload(false, true);
  }, delay);
}
