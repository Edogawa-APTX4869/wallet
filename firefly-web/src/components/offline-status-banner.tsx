"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, CloudOff, KeyRound, RefreshCw, Trash2, Wifi } from "lucide-react";
import { removeOfflineQueueItem } from "@/lib/offline-store";
import { syncOfflineQueue, useOfflineSync } from "@/lib/offline-sync";
import { reauthenticateWalletSession } from "@/lib/native-wallet";
import { formatDateTime } from "@/lib/utils";
import { Badge, Button, ErrorBox, Field, Input, ModalSheet } from "@/components/ui";
import { useToast } from "@/components/providers";

export function OfflineStatusBanner({ serverUrl }: { serverUrl: string }) {
  const sync = useOfflineSync();
  const qc = useQueryClient();
  const toast = useToast();

  const [queueOpen, setQueueOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authUrl, setAuthUrl] = useState(serverUrl);
  const [authToken, setAuthToken] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const pendingCount = sync.queue.length;
  const failedCount = sync.queue.filter((it) => it.status === "failed").length;
  const isAuthRequired = sync.syncPhase === "auth_required";
  const isBusy = sync.syncPhase === "validating_auth" || sync.syncPhase === "syncing";

  // Completely invisible when online, authenticated, and queue is empty
  if (sync.isOnline && pendingCount === 0 && !isAuthRequired && !isBusy) {
    return null;
  }

  async function handleManualSync() {
    const res = await syncOfflineQueue({ validateOnlyWhenEmpty: true });
    if (res.authRequired) {
      setAuthOpen(true);
    } else if (res.offline) {
      toast("Still offline — changes remain queued safely.", "info");
    } else if (res.synced > 0) {
      toast(`Synced ${res.synced} change${res.synced === 1 ? "" : "s"}`);
      void qc.invalidateQueries();
    } else if (res.failed > 0) {
      toast(`${res.failed} queued item${res.failed === 1 ? "" : "s"} need review.`, "error");
    }
  }

  async function handleReconnectSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!authToken.trim()) {
      setAuthError("Enter your Personal Access Token to verify authentication.");
      return;
    }
    setAuthLoading(true);
    setAuthError(null);
    try {
      await reauthenticateWalletSession({
        url: authUrl.trim() || serverUrl,
        token: authToken.trim(),
      });
      setAuthToken("");
      setAuthOpen(false);
      toast("Authentication verified — syncing queued changes…", "info");
      await syncOfflineQueue({ validateOnlyWhenEmpty: true });
      void qc.invalidateQueries();
    } catch (err) {
      setAuthError((err as Error).message);
    } finally {
      setAuthLoading(false);
    }
  }

  return (
    <>
      <div
        role="status"
        data-testid="offline-status-banner"
        className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-surface px-3.5 py-2.5 text-xs shadow-xs"
      >
        <button
          type="button"
          onClick={() => setQueueOpen(true)}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        >
          {isAuthRequired ? (
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-danger-soft text-danger">
              <KeyRound className="size-3.5" aria-hidden />
            </span>
          ) : !sync.isOnline ? (
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-warning-soft text-warning">
              <CloudOff className="size-3.5" aria-hidden />
            </span>
          ) : isBusy ? (
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
              <RefreshCw className="size-3.5 animate-spin" aria-hidden />
            </span>
          ) : failedCount > 0 ? (
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-danger-soft text-danger">
              <AlertTriangle className="size-3.5" aria-hidden />
            </span>
          ) : (
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
              <Wifi className="size-3.5" aria-hidden />
            </span>
          )}

          <div className="min-w-0">
            <p className="truncate font-semibold text-fg">
              {isAuthRequired
                ? `Session expired · ${pendingCount} pending`
                : !sync.isOnline
                  ? `Offline mode${pendingCount > 0 ? ` · ${pendingCount} queued` : ""}`
                  : sync.syncPhase === "validating_auth"
                    ? "Validating authentication…"
                    : sync.syncPhase === "syncing"
                      ? `Syncing ${pendingCount} change${pendingCount === 1 ? "" : "s"}…`
                      : `${pendingCount} offline change${pendingCount === 1 ? "" : "s"} pending`}
            </p>
            <p className="truncate text-[11px] text-muted">
              {isAuthRequired
                ? "Verify your Firefly III token to send saved changes."
                : !sync.isOnline
                  ? "Changes are saved locally and sync automatically when online."
                  : failedCount > 0
                    ? `${failedCount} failed — tap to inspect.`
                    : "Tap to inspect queue."}
            </p>
          </div>
        </button>

        <div className="flex shrink-0 items-center gap-1.5">
          {isAuthRequired ? (
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setAuthUrl(serverUrl);
                setAuthOpen(true);
              }}
              className="!min-h-8 h-8 px-3 text-xs"
            >
              Verify &amp; Sync
            </Button>
          ) : (
            sync.isOnline &&
            pendingCount > 0 && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                loading={isBusy}
                onClick={handleManualSync}
                className="!min-h-8 h-8 px-3 text-xs"
              >
                Sync now
              </Button>
            )
          )}
        </div>
      </div>

      {/* Offline Queue Inspector Modal */}
      <ModalSheet
        open={queueOpen}
        onClose={() => setQueueOpen(false)}
        title="Offline Sync Queue"
        subtitle={
          sync.isOnline
            ? sync.authValid === false
              ? "Online · Authentication required"
              : "Online · Ready to validate & sync"
            : "Offline · Stored safely on device"
        }
      >
        <div className="flex flex-col gap-3">
          {sync.lastError && <ErrorBox error={sync.lastError} />}

          {sync.queue.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-muted">
              <CheckCircle2 className="size-8 text-success" aria-hidden />
              <p>All changes are synced with Firefly III.</p>
            </div>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
              {sync.queue.map((item) => (
                <li key={item.id} className="flex items-start justify-between gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-semibold text-fg">{item.label}</span>
                      <Badge
                        tone={
                          item.status === "failed"
                            ? "danger"
                            : item.status === "syncing"
                              ? "primary"
                              : "warning"
                        }
                      >
                        {item.status === "failed"
                          ? "Failed"
                          : item.status === "syncing"
                            ? "Syncing"
                            : "Queued"}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted">{formatDateTime(item.createdAt)}</p>
                    {item.lastError && <p className="mt-1 text-xs text-danger">{item.lastError}</p>}
                  </div>
                  <button
                    type="button"
                    onClick={() => void removeOfflineQueueItem(item.id)}
                    aria-label={`Discard ${item.label}`}
                    className="!min-h-0 !min-w-0 rounded-lg p-1.5 text-muted hover:bg-danger-soft hover:text-danger transition"
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-border">
            {isAuthRequired && (
              <Button
                type="button"
                onClick={() => {
                  setQueueOpen(false);
                  setAuthOpen(true);
                }}
              >
                Verify Authentication
              </Button>
            )}
            <Button
              type="button"
              variant="secondary"
              loading={isBusy}
              disabled={!sync.isOnline || sync.queue.length === 0}
              onClick={handleManualSync}
            >
              <RefreshCw className="size-3.5" aria-hidden /> Validate Auth &amp; Sync All
            </Button>
          </div>
        </div>
      </ModalSheet>

      {/* Inline Re-Authentication Modal when token/session expired offline */}
      <ModalSheet
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        title="Verify Authentication"
        subtitle={`Validate session before syncing ${pendingCount} pending change${pendingCount === 1 ? "" : "s"}`}
      >
        <form onSubmit={handleReconnectSubmit} noValidate className="flex flex-col gap-3">
          <Field label="Firefly III URL">
            {(id) => (
              <Input
                id={id}
                type="text"
                inputMode="url"
                autoComplete="url"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                value={authUrl}
                onChange={(e) => setAuthUrl(e.target.value)}
                onInput={(e) => setAuthUrl((e.target as HTMLInputElement).value)}
              />
            )}
          </Field>
          <Field label="Personal Access Token">
            {(id) => (
              <Input
                id={id}
                type="text"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                style={{ WebkitTextSecurity: "disc" } as React.CSSProperties}
                value={authToken}
                onChange={(e) => setAuthToken(e.target.value)}
                onInput={(e) => setAuthToken((e.target as HTMLInputElement).value)}
                placeholder="Paste Firefly III Personal Access Token"
                autoFocus
              />
            )}
          </Field>
          <ErrorBox error={authError} />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setAuthOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={authLoading}>
              Verify &amp; Sync
            </Button>
          </div>
        </form>
      </ModalSheet>
    </>
  );
}
