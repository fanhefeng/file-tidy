/** Only dirty drafts should block native close, quit and reload. */
export function protectUnsavedChanges(target: Window, dirty: boolean): () => void {
  if (!dirty) return () => {};
  const preventUnload = (event: BeforeUnloadEvent) => {
    event.preventDefault();
    // Electron requires returnValue even when preventDefault was called.
    event.returnValue = "";
  };
  target.addEventListener("beforeunload", preventUnload);
  return () => target.removeEventListener("beforeunload", preventUnload);
}
