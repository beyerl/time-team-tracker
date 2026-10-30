/**
 * Saving the exported backup file.
 *
 * In a browser an <a download> link does the job. The Android app's WebView
 * ignores such links - nothing is saved, with no error - so there the file is
 * written with the Filesystem plugin and offered through the share sheet.
 */

import { Capacitor } from '@capacitor/core';

export const isNativeApp = () => Capacitor.isNativePlatform();

export const backupFileName = () => `time-team-tracker-${new Date().toISOString().slice(0, 10)}.json`;

function downloadInBrowser(text, fileName) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoking straight away can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'Backup downloaded.';
}

/** "Share canceled" is the user closing the sheet, not a failure. */
const wasCancelled = (error) => /cancel/i.test(String(error?.message ?? error));

async function saveInApp(text, fileName) {
  const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
  const { Share } = await import('@capacitor/share');

  // The public Documents folder outlives an uninstall. Android 10 and older
  // need a storage permission for it, so fall back to the app's cache - the
  // share sheet below is then the way to get the file off the device.
  let saved = null;
  try {
    const result = await Filesystem.writeFile({
      path: fileName,
      data: text,
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
      recursive: true,
    });
    saved = { uri: result.uri, where: `Documents/${fileName}` };
  } catch {
    const result = await Filesystem.writeFile({
      path: fileName,
      data: text,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });
    saved = { uri: result.uri, where: null };
  }

  const savedNote = saved.where ? `Backup saved to ${saved.where}.` : 'Backup ready.';
  try {
    if ((await Share.canShare()).value) {
      await Share.share({ title: 'Time Team Tracker backup', files: [saved.uri] });
      return `${savedNote} Shared.`;
    }
  } catch (error) {
    if (wasCancelled(error)) return savedNote;
    if (!saved.where) throw error;
  }
  return savedNote;
}

/** Save the backup the way this platform allows; resolves to a status line. */
export function saveBackup(text, fileName = backupFileName()) {
  return isNativeApp() ? saveInApp(text, fileName) : Promise.resolve(downloadInBrowser(text, fileName));
}
