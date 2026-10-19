import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  outputDir: path.join(root, "frontend/test-results"),
  testDir: "./tests",
  workers: 1,
  fullyParallel: false,
  timeout: 60000,
  use: { baseURL: "http://127.0.0.1:8897", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: {
    command: `"${path.join(root, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python")}" -m uvicorn airbnb_price.web:app --host 127.0.0.1 --port 8897`,
    cwd: root,
    url: "http://127.0.0.1:8897/health",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
