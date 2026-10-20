"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ServiceReadinessChecks = {
  configuration: boolean;
  redis: boolean;
  worker: boolean;
};

export type ServiceReadinessStatus = "checking" | "ready" | "unavailable";

export type ServiceReadiness = {
  status: ServiceReadinessStatus;
  checks: ServiceReadinessChecks | null;
  offline: boolean;
  loading: boolean;
  retry: () => void;
};

type ReadyPayload = {
  ok: boolean;
  checks: ServiceReadinessChecks;
};

const READY_URL = "/api/ready";
const TIMEOUT_MS = 5000;

function isChecks(value: unknown): value is ServiceReadinessChecks {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.configuration === "boolean" &&
    typeof v.redis === "boolean" &&
    typeof v.worker === "boolean"
  );
}

function isReadyPayload(value: unknown): value is ReadyPayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.ok === "boolean" && isChecks(v.checks);
}

function isOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine !== false;
}

export function useServiceReadiness(): ServiceReadiness {
  const [status, setStatus] = useState<ServiceReadinessStatus>("checking");
  const [checks, setChecks] = useState<ServiceReadinessChecks | null>(null);
  const [offline, setOffline] = useState<boolean>(() => !isOnline());
  const [loading, setLoading] = useState<boolean>(true);
  const [attempt, setAttempt] = useState(0);
  const requestId = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  const retry = useCallback(() => {
    if (!isOnline()) {
      requestId.current += 1;
      controllerRef.current?.abort();
      setOffline(true);
      setChecks(null);
      setStatus("unavailable");
      setLoading(false);
      return;
    }
    setOffline(false);
    setStatus("checking");
    setLoading(true);
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    const onOnline = () => {
      setOffline(false);
      setStatus("checking");
      setLoading(true);
      setAttempt((n) => n + 1);
    };
    const onOffline = () => {
      requestId.current += 1;
      controllerRef.current?.abort();
      setOffline(true);
      setChecks(null);
      setStatus("unavailable");
      setLoading(false);
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    if (!isOnline()) {
      setOffline(true);
      setChecks(null);
      setStatus("unavailable");
      setLoading(false);
      return;
    }

    const id = requestId.current + 1;
    requestId.current = id;
    const controller = new AbortController();
    controllerRef.current = controller;
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let settled = false;

    setStatus("checking");
    setLoading(true);

    (async () => {
      try {
        const res = await fetch(READY_URL, {
          method: "GET",
          cache: "no-store",
          signal: controller.signal,
        });
        let data: unknown = null;
        try {
          data = await res.json();
        } catch {
          data = null;
        }
        if (settled || requestId.current !== id) return;
        if (
          res.ok &&
          isReadyPayload(data) &&
          data.ok &&
          data.checks.configuration &&
          data.checks.redis &&
          data.checks.worker
        ) {
          setChecks(data.checks);
          setStatus("ready");
        } else if (isReadyPayload(data)) {
          setChecks(data.checks);
          setStatus("unavailable");
        } else {
          setChecks(null);
          setStatus("unavailable");
        }
      } catch {
        if (settled || requestId.current !== id) return;
        setChecks(null);
        setStatus("unavailable");
      } finally {
        if (!settled && requestId.current === id) setLoading(false);
        clearTimeout(timer);
      }
    })();

    return () => {
      settled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [attempt]);

  return { status, checks, offline, loading, retry };
}
