import { api } from "../core.js";

// общее состояние панели
export const ctx = {
  user: null,
  meta: null,
  assignees: [],
  locations: [],
};

export const can = {
  manage: () => ["admin", "staff"].includes(ctx.user?.role),
  admin: () => ctx.user?.role === "admin",
};

export function initials(name = "") {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join("");
}

export function category(idOrCode) {
  return ctx.meta.categories.find((c) => c.id === idOrCode || c.code === idOrCode);
}

export async function loadAssignees() {
  ctx.assignees = await api("/api/staff/assignees");
  return ctx.assignees;
}

export async function loadLocations() {
  ctx.locations = await api("/api/locations");
  return ctx.locations;
}

export function parseHash() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [path, query = ""] = raw.split("?");
  const parts = path.split("/").filter(Boolean);
  return { page: parts[0] || "tickets", id: parts[1] ? Number(parts[1]) : null, params: new URLSearchParams(query) };
}

export function go(hash) {
  if (location.hash === hash) window.dispatchEvent(new HashChangeEvent("hashchange"));
  else location.hash = hash;
}
