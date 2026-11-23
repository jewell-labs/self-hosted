const rows = document.querySelector("#log-rows");
const status = document.querySelector("#log-status");
const alert = document.querySelector("#log-alert");
const filter = document.querySelector(".filter");
const pluginInput = document.querySelector("#plugin-filter");
const typeInput = document.querySelector("#type-filter");
const nameInput = document.querySelector("#name-filter");
const scroller = document.querySelector(".table-wrapper");
const seen = new Set();
const params = new URLSearchParams(location.search);
const fields = {
  plugin: pluginInput,
  type: typeInput,
  name: nameInput,
};
let selected = {
  plugin: params.get("plugin") ?? "",
  type: params.get("type") ?? "",
  name: params.get("name") ?? "",
};
let source;
let pending = 0;
let latest = "";
let timer = 0;

for (const [key, input] of Object.entries(fields)) input.value = selected[key];

filter.addEventListener("submit", (event) => {
  event.preventDefault();
  selected = {
    plugin: pluginInput.value.trim(),
    type: typeInput.value.trim(),
    name: nameInput.value.trim(),
  };
  const next = new URL(location.href);
  for (const [key, value] of Object.entries(selected)) {
    if (value) next.searchParams.set(key, value);
    else next.searchParams.delete(key);
  }
  history.replaceState(null, "", next);
  seen.clear();
  rows.replaceChildren();
  connect();
});

function pinned() {
  return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 48;
}

function addRow(row, announce) {
  if (!row || seen.has(row.id)) return;
  seen.add(row.id);
  const empty = rows.querySelector(".empty");
  if (empty) empty.remove();
  const follow = pinned();
  const tr = document.createElement("tr");
  tr.dataset.id = String(row.id);
  const time = document.createElement("th");
  time.scope = "row";
  const stamp = document.createElement("time");
  stamp.dateTime = row.at;
  stamp.textContent = row.at;
  time.append(stamp);
  tr.append(
    time,
    cell("td", row.plugin, "plugin"),
    cell("td", row.type, "type"),
    cell("td", row.name, "name"),
    cell("td", row.detail, row.detail === "error" ? "detail error" : "detail"),
  );
  rows.append(tr);
  while (rows.children.length > 500) {
    const first = rows.firstElementChild;
    seen.delete(first?.dataset.id);
    first?.remove();
  }
  if (follow) scroller.scrollTop = scroller.scrollHeight;
  if (!announce) return;
  pending += 1;
  latest = `${row.plugin} ${row.type} ${row.name}`;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    const count = pending;
    status.textContent = `${count} new ${count === 1 ? "event" : "events"}. Latest is ${latest}.`;
    pending = 0;
  }, 400);
}

function cell(tag, text, className) {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text ?? "";
  return node;
}

function showEmpty() {
  if (rows.children.length > 0) return;
  const tr = document.createElement("tr");
  tr.className = "empty";
  const td = document.createElement("td");
  td.colSpan = 5;
  td.textContent = "No events yet.";
  tr.append(td);
  rows.append(tr);
}

async function openStream() {
  const response = await fetch("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "events.webhooks", arguments: {} },
    }),
  });
  if (!response.ok) throw new Error(String(response.status));
  const body = await response.json();
  const text = body?.result?.content?.[0]?.text;
  const listed = JSON.parse(text);
  if (listed.stream !== "/events") throw new Error("stream");
  if (!listed.query?.includes("plugin") || !listed.query.includes("type") || !listed.query.includes("name")) {
    throw new Error("query");
  }
  const url = new URL(listed.stream, location.origin);
  for (const [key, value] of Object.entries(selected)) {
    if (value) url.searchParams.set(key, value);
  }
  return url;
}

function connect() {
  if (source) source.close();
  alert.textContent = "";
  showEmpty();
  openStream().then((url) => {
    source = new EventSource(url);
    source.onopen = () => {
      alert.textContent = "";
      if (!status.textContent) status.textContent = "Live.";
    };
    source.onmessage = (message) => {
      try {
        addRow(JSON.parse(message.data), true);
      } catch {
        alert.textContent = "The log stream sent a row this page could not read.";
      }
    };
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) {
        alert.textContent = "The log stream disconnected.";
        return;
      }
      status.textContent = "Reconnecting.";
    };
  }).catch(() => {
    alert.textContent = "The log stream could not be read.";
  });
}

connect();
