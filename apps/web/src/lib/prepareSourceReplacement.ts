import {
  useWorkbenchStore,
  type WorkbenchState,
} from "@/stores/workbenchStore";

/** Flush the exact source being previewed before a bulk replacement. The next
 * durable save checkpoints that source atomically with its replacement. */
export async function prepareSourceReplacement(
  args: { expectedDocumentRevision: number },
  store: { getState: () => WorkbenchState } = useWorkbenchStore,
) {
  const initial = store.getState();
  if (initial.projectRole === "viewer")
    return { proceed: false, message: "Viewers cannot change source." };
  const projectId = initial.projectId;
  await initial.saveAllDirtyFiles();
  const current = store.getState();
  if (
    current.projectId === projectId &&
    current.documentRevision === args.expectedDocumentRevision &&
    current.saveStatus === "saved"
  ) {
    await current.persistence.checkpointSource?.(args.expectedDocumentRevision);
  }
  const afterCheckpoint = store.getState();
  return afterCheckpoint.projectRole !== "viewer" &&
    afterCheckpoint.projectId === projectId &&
    afterCheckpoint.documentRevision === args.expectedDocumentRevision &&
    afterCheckpoint.saveStatus === "saved"
    ? { proceed: true }
    : {
        proceed: false,
        message:
          "The source changed or could not be checkpointed. Save your work and refresh the preview.",
      };
}
