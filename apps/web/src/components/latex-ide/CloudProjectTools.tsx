"use client";
import React, { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useWorkbenchStore } from "@/stores/workbenchStore";
import { prepareSourceReplacement } from "@/lib/prepareSourceReplacement";
import { ProjectCheckpointRecovery } from "./ProjectCheckpointRecovery";
import { resolveAnchor } from "@/lib/sourceAnchors";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const button =
  "rounded border border-border px-2 py-1.5 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40";
const input = "w-full rounded border border-border bg-background p-2 text-sm";
type Selection = {
  path: string;
  from: number;
  to: number;
  revision: number;
  original: string;
};
export function CloudProjectTools({
  projectId,
}: {
  projectId: Id<"projects">;
}) {
  const [tab, setTab] = useState<"share" | "history" | "review" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const role = useWorkbenchStore((s) => s.projectRole);
  const editable = role === "owner" || role === "editor";
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"editor" | "viewer">("editor");
  const [revisionId, setRevisionId] = useState<Id<"sourceHistory"> | null>(
    null,
  );
  const [selection, setSelection] = useState<Selection | null>(null);
  const [message, setMessage] = useState("");
  const [replacement, setReplacement] = useState("");
  const [replyText, setReplyText] = useState<Record<string, string>>({});
  const members = useQuery(
    api.members.list,
    tab === "share" ? { projectId } : "skip",
  );
  const history = useQuery(
    api.sourceHistory.list,
    tab === "history" ? { projectId } : "skip",
  );
  const revision = useQuery(
    api.sourceHistory.get,
    tab === "history" && revisionId ? { revisionId } : "skip",
  );
  const reviews = useQuery(
    api.reviews.list,
    tab === "review" ? { projectId } : "skip",
  );
  const setRole = useMutation(api.members.setRole);
  const revokeInvite = useMutation(api.members.revokeInvite);
  const restore = useMutation(api.sourceHistory.restore);
  const comment = useMutation(api.reviews.comment);
  const reply = useMutation(api.reviews.reply);
  const resolve = useMutation(api.reviews.resolve);
  const suggest = useMutation(api.reviews.suggest);
  const decide = useMutation(api.reviews.decide);
  const files = useWorkbenchStore((s) => s.filesByPath);
  async function run(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not complete the action. Your source is still available.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function saved() {
    const result = await prepareSourceReplacement({
      expectedDocumentRevision: useWorkbenchStore.getState().documentRevision,
    });
    if (!result.proceed) throw new Error(result.message);
    if (useWorkbenchStore.getState().projectId !== projectId)
      throw new Error("Project changed. Reopen this dialog.");
    return useWorkbenchStore.getState();
  }
  function capture() {
    const state = useWorkbenchStore.getState();
    const path = state.activeFileId;
    if (
      !path ||
      !Object.hasOwn(state.filesByPath, path) ||
      state.filesByPath[path].startsWith("data:")
    ) {
      setError("Open a text file and select a passage first.");
      return;
    }
    const from = state.activeSelection?.start ?? 0;
    const to = state.activeSelection?.end ?? from;
    setSelection({
      path,
      from,
      to,
      revision: state.documentRevision,
      original: state.filesByPath[path].slice(from, to),
    });
    setReplacement(state.filesByPath[path].slice(from, to));
    setMessage("");
    setError("");
  }
  async function anchor() {
    if (!selection) throw new Error("Capture a selection first.");
    const state = await saved();
    if (
      state.documentRevision !== selection.revision ||
      state.filesByPath[selection.path]?.slice(selection.from, selection.to) !==
        selection.original
    )
      throw new Error("Source changed. Capture the selection again.");
    const token = state.incarnationsByPath[selection.path];
    if (!token) throw new Error("Wait for this file to finish saving.");
    return {
      projectId,
      path: selection.path,
      from: selection.from,
      to: selection.to,
      expectedVersion: state.versionsByPath[selection.path],
      expectedIncarnation: token,
    };
  }
  return (
    <>
      {(["share", "history", "review"] as const).map((value) => (
        <button
          type="button"
          className={button}
          key={value}
          aria-haspopup="dialog"
          onClick={() => {
            setTab(value);
            setError("");
            setNotice("");
            if (value === "review") capture();
          }}
        >
          {value === "share"
            ? "Share"
            : value === "history"
              ? "History"
              : "Review"}
        </button>
      ))}
      <Dialog
        open={tab !== null}
        onOpenChange={(open) => {
          if (!busy && !open) {
            setTab(null);
            setRevisionId(null);
          }
        }}
      >
        <DialogContent
          className="max-h-[90dvh] max-w-3xl overflow-y-auto"
          onEscapeKeyDown={(e) => {
            if (busy) e.preventDefault();
          }}
          onPointerDownOutside={(e) => {
            if (busy) e.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {tab === "share"
                ? "Project access"
                : tab === "history"
                  ? "Server source history"
                  : "Comments and tracked changes"}
            </DialogTitle>
            <DialogDescription>
              {tab === "share"
                ? "Owners manage access. Editors can change source and review. Viewers can read and export."
                : tab === "history"
                  ? "Preview saved revisions before restoring a file. Restores checkpoint the current source. Retention: 100 entries or 8 MiB per project."
                  : "Select source in the editor, then capture it here. Proposed changes stay separate from source until accepted. Context checks prevent applying changes to a different passage."}
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="text-sm">
              {notice}
            </p>
          )}
          {tab === "share" && (
            <div className="space-y-4">
              <p className="text-sm">
                Your role: {role}. Owner:{" "}
                {role === "owner" ? "You" : "Project owner"}
              </p>
              {role === "owner" && (
                <form
                  className="space-y-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run(async () => {
                      const response = await fetch("/api/projects/invite", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          projectId,
                          email,
                          role: inviteRole,
                        }),
                      });
                      const data = await response.json();
                      if (!response.ok)
                        throw new Error(data.error ?? "Invitation failed.");
                      setEmail("");
                      setNotice(
                        "Invitation created. The recipient can accept it on Projects within seven days.",
                      );
                    });
                  }}
                >
                  <label className="block text-sm">
                    Existing account email
                    <input
                      required
                      type="email"
                      aria-label="Invite account email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className={input}
                    />
                  </label>
                  <label className="block text-sm">
                    Invitation role
                    <select
                      aria-label="Invitation role"
                      className={input}
                      value={inviteRole}
                      onChange={(e) =>
                        setInviteRole(e.target.value as "editor" | "viewer")
                      }
                    >
                      <option value="editor">Editor</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  </label>
                  <button className={button} disabled={busy}>
                    Invite collaborator
                  </button>
                </form>
              )}
              {members?.members.map((member) => (
                <div
                  key={member._id}
                  className="flex flex-wrap items-center gap-2 text-sm"
                >
                  <span className="flex-1 break-all">
                    {member.displayName ?? "Collaborator"}
                  </span>
                  {role === "owner" ? (
                    <>
                      <select
                        aria-label={`Role for ${member.userId}`}
                        disabled={busy}
                        value={member.role}
                        className="rounded border bg-background p-1"
                        onChange={(e) =>
                          void run(() =>
                            setRole({
                              projectId,
                              userId: member.userId,
                              role: e.target.value as "editor" | "viewer",
                            }),
                          )
                        }
                      >
                        <option value="editor">Editor</option>
                        <option value="viewer">Viewer</option>
                      </select>
                      <button
                        className={button}
                        disabled={busy}
                        onClick={() =>
                          void run(() =>
                            setRole({
                              projectId,
                              userId: member.userId,
                              role: null,
                            }),
                          )
                        }
                      >
                        Remove
                      </button>
                    </>
                  ) : (
                    <span>{member.role}</span>
                  )}
                </div>
              ))}
              {members?.invitations.map((invitation) => (
                <div
                  key={invitation._id}
                  className="flex flex-wrap items-center gap-2 text-sm"
                >
                  <span className="flex-1 break-all">
                    Pending: {invitation.displayName ?? "Invited collaborator"}{" "}
                    ({invitation.role}) — expires{" "}
                    {new Date(invitation.expiresAt).toLocaleDateString()}
                  </span>
                  <button
                    className={button}
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        revokeInvite({ invitationId: invitation._id }),
                      )
                    }
                  >
                    Revoke invitation
                  </button>
                </div>
              ))}
            </div>
          )}
          {tab === "history" && (
            <div className="space-y-3">
              <ProjectCheckpointRecovery projectId={projectId} />
              {!history ? (
                <p role="status">Loading revisions…</p>
              ) : !history.length ? (
                <p>
                  No revisions yet. Source saves create history automatically.
                </p>
              ) : (
                <label className="block text-sm">
                  Saved revision
                  <select
                    className={input}
                    aria-label="Saved revision"
                    value={revisionId ?? ""}
                    onChange={(e) =>
                      setRevisionId(
                        (e.target.value as Id<"sourceHistory">) || null,
                      )
                    }
                  >
                    <option value="">Choose a revision</option>
                    {history.map((row) => (
                      <option key={row._id} value={row._id}>
                        {row.path} · v{row.version} · {row.operation} ·{" "}
                        {new Date(row.createdAt).toLocaleString()}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {revision && (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <p className="text-xs font-medium">
                        Current: {revision.path}
                      </p>
                      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded border p-2 text-xs">
                        {files[revision.path] ?? "(file deleted)"}
                      </pre>
                    </div>
                    <div>
                      <p className="text-xs font-medium">Saved revision</p>
                      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded border p-2 text-xs">
                        {revision.content}
                      </pre>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      className={button}
                      disabled={busy || !editable}
                      onClick={() =>
                        void run(async () => {
                          const state = await saved();
                          await restore({
                            revisionId: revision._id,
                            expectedVersion:
                              state.versionsByPath[revision.path] ?? 0,
                            expectedIncarnation:
                              state.incarnationsByPath[revision.path],
                          });
                          setNotice(
                            "Revision restored. The previous source remains in history.",
                          );
                        })
                      }
                    >
                      Restore this file
                    </button>
                    <button
                      className={button}
                      onClick={() => {
                        const url = URL.createObjectURL(
                          new Blob([revision.content], {
                            type: "text/plain;charset=utf-8",
                          }),
                        );
                        const link = document.createElement("a");
                        link.href = url;
                        link.download =
                          revision.path.split("/").at(-1) ?? "revision.txt";
                        link.click();
                        setTimeout(() => URL.revokeObjectURL(url), 1000);
                      }}
                    >
                      Download revision
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
          {tab === "review" && (
            <div className="space-y-5">
              {editable && (
                <section className="space-y-2 rounded border p-3">
                  <button className={button} disabled={busy} onClick={capture}>
                    Capture editor selection
                  </button>
                  {selection && (
                    <>
                      <p className="text-xs">
                        {selection.path}, characters {selection.from}–
                        {selection.to}
                      </p>
                      <pre className="max-h-24 overflow-auto whitespace-pre-wrap text-xs">
                        {selection.original || "(insertion at cursor)"}
                      </pre>
                      <label className="block text-sm">
                        Comment
                        <textarea
                          aria-label="New comment"
                          maxLength={8000}
                          value={message}
                          onChange={(e) => setMessage(e.target.value)}
                          className={input}
                        />
                      </label>
                      <button
                        className={button}
                        disabled={busy || !message.trim()}
                        onClick={() =>
                          void run(async () => {
                            await comment({
                              ...(await anchor()),
                              body: message,
                            });
                            setMessage("");
                            setNotice("Comment added.");
                          })
                        }
                      >
                        Add comment
                      </button>
                      <label className="block text-sm">
                        Proposed replacement
                        <textarea
                          aria-label="Proposed replacement"
                          maxLength={16000}
                          value={replacement}
                          onChange={(e) => setReplacement(e.target.value)}
                          className={input}
                        />
                      </label>
                      <button
                        className={button}
                        disabled={busy || replacement === selection.original}
                        onClick={() =>
                          void run(async () => {
                            await suggest({ ...(await anchor()), replacement });
                            setNotice(
                              "Change proposed. Source stays unchanged until acceptance.",
                            );
                          })
                        }
                      >
                        Propose tracked change
                      </button>
                    </>
                  )}
                </section>
              )}
              {!reviews ? (
                <p role="status">Loading review…</p>
              ) : (
                <>
                  <h3 className="font-medium">Comments</h3>
                  {!reviews.threads.length && (
                    <p className="text-sm">No comments yet.</p>
                  )}
                  {reviews.threads.map((thread) => {
                    const range = Object.hasOwn(files, thread.path)
                      ? resolveAnchor(files[thread.path], {
                          ...thread,
                          original: thread.quote,
                        })
                      : null;
                    return (
                      <article
                        key={thread._id}
                        className="space-y-2 rounded border p-3 text-sm"
                      >
                        <p>
                          {thread.path} ·{" "}
                          {thread.resolved ? "Resolved" : "Open"} ·{" "}
                          {range ? "Anchored" : "Passage changed"}
                        </p>
                        {range && (
                          <button
                            type="button"
                            className={button}
                            onClick={() => {
                              setTab(null);
                              useWorkbenchStore
                                .getState()
                                .openFile(thread.path);
                              useWorkbenchStore.setState({
                                nextSelection: {
                                  start: range.from,
                                  end: range.to,
                                },
                              });
                            }}
                          >
                            Go to comment passage
                          </button>
                        )}
                        <blockquote className="border-l-2 pl-2 whitespace-pre-wrap">
                          {thread.quote || "(insertion point)"}
                        </blockquote>
                        {thread.messages.map((item) => (
                          <p
                            key={item._id}
                            className="whitespace-pre-wrap break-words"
                          >
                            <span className="text-xs text-muted-foreground">
                              {item.authorName ?? "Collaborator"}:{" "}
                            </span>
                            {item.body}
                          </p>
                        ))}
                        {editable && (
                          <>
                            <input
                              aria-label={`Reply to thread ${thread._id}`}
                              className={input}
                              maxLength={8000}
                              value={replyText[thread._id] ?? ""}
                              onChange={(e) =>
                                setReplyText({
                                  ...replyText,
                                  [thread._id]: e.target.value,
                                })
                              }
                            />
                            <button
                              className={button}
                              disabled={busy || !replyText[thread._id]?.trim()}
                              onClick={() =>
                                void run(async () => {
                                  await reply({
                                    threadId: thread._id,
                                    body: replyText[thread._id],
                                  });
                                  setReplyText((current) => ({
                                    ...current,
                                    [thread._id]: "",
                                  }));
                                })
                              }
                            >
                              Reply
                            </button>{" "}
                            <button
                              className={button}
                              disabled={busy}
                              onClick={() =>
                                void run(() =>
                                  resolve({
                                    threadId: thread._id,
                                    resolved: !thread.resolved,
                                  }),
                                )
                              }
                            >
                              {thread.resolved ? "Reopen" : "Resolve"}
                            </button>
                          </>
                        )}
                      </article>
                    );
                  })}
                  <h3 className="font-medium">Tracked changes</h3>
                  {!reviews.suggestions.length && (
                    <p className="text-sm">No changes proposed.</p>
                  )}
                  {reviews.suggestions.map((change) => (
                    <article
                      key={change._id}
                      className="space-y-2 rounded border p-3 text-sm"
                    >
                      <p>
                        {change.path} · {change.status} ·{" "}
                        {change.authorName ?? "Collaborator"}
                      </p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <pre
                          aria-label="Original passage"
                          className="overflow-auto whitespace-pre-wrap break-all border p-2"
                        >
                          <del>{change.original || "(insertion)"}</del>
                        </pre>
                        <pre
                          aria-label="Suggested passage"
                          className="overflow-auto whitespace-pre-wrap break-all border p-2"
                        >
                          <ins>{change.replacement || "(deletion)"}</ins>
                        </pre>
                      </div>
                      {change.status === "pending" && editable && (
                        <>
                          <button
                            className={button}
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                const state = await saved();
                                await decide({
                                  suggestionId: change._id,
                                  accept: true,
                                  expectedVersion:
                                    state.versionsByPath[change.path],
                                  expectedIncarnation:
                                    state.incarnationsByPath[change.path],
                                });
                                setNotice(
                                  "Change accepted; prior source checkpointed.",
                                );
                              })
                            }
                          >
                            Accept change
                          </button>{" "}
                          <button
                            className={button}
                            disabled={busy}
                            onClick={() =>
                              void run(() =>
                                decide({
                                  suggestionId: change._id,
                                  accept: false,
                                }),
                              )
                            }
                          >
                            Reject change
                          </button>
                        </>
                      )}
                    </article>
                  ))}
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
