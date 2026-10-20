import { expect, test } from "@playwright/test";

test("local compile rejects foreign origins and form submissions", async ({ request, baseURL }) => {
  const payload = { projectId: "local-access-test", mainFile: "main.tex", files: { "main.tex": "source" } };
  const foreignPost = await request.post("/api/compile", {
    data: payload, headers: { origin: "https://foreign.test" },
  });
  expect(foreignPost.status()).toBe(403);
  expect(foreignPost.headers()["access-control-allow-origin"]).toBeUndefined();
  const foreignPoll = await request.get("/api/compile/not-a-job", {
    headers: { origin: "https://foreign.test" },
  });
  expect(foreignPoll.status()).toBe(403);
  const sameSite = await request.post("/api/compile", {
    data: payload, headers: { origin: baseURL!, "sec-fetch-site": "same-site" },
  });
  expect(sameSite.status()).toBe(403);
  const form = await request.post("/api/compile", {
    data: JSON.stringify(payload), headers: { "content-type": "text/plain" },
  });
  expect(form.status()).toBe(415);
  const missing = await request.get("/api/compile/not-a-job");
  expect(missing.status()).toBe(404);
  expect(await missing.json()).toEqual({ error: "not found" });
});
