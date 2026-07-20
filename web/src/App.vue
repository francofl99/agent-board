<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import Card from "./components/Card.vue";
import {
  createColumn,
  deleteColumn,
  fetchColumns,
  fetchSessions,
  patchState,
  renameColumn,
  reorderColumns,
  subscribe,
} from "./api";
import {
  columnIdOf,
  projectKey,
  projectName,
  PROVIDERS,
  STATUS,
  tildePath,
  type BoardColumn,
  type Provider,
  type Session,
  type SessionStatus,
} from "./types";

const sessions = ref<Session[]>([]);
const columns = ref<BoardColumn[]>([]);
const loading = ref(true);
const dragId = ref<string | null>(null); // session being dragged
const dragColId = ref<string | null>(null); // column being reordered
const dropColId = ref<string | null>(null); // column under the cursor
const selected = ref<Session | null>(null);
const notesDraft = ref("");

let unsub: (() => void) | null = null;

async function load() {
  const [ss, cols] = await Promise.all([fetchSessions(), fetchColumns()]);
  sessions.value = ss;
  columns.value = cols.slice().sort((a, b) => a.position - b.position);
  loading.value = false;
  if (selected.value) {
    const fresh = sessions.value.find((s) => s.id === selected.value!.id);
    if (fresh) selected.value = fresh;
  }
}

onMounted(async () => {
  await load();
  unsub = subscribe(load);
});
onUnmounted(() => unsub?.());

// --- Filters (provider / project / status) ---
const activeProviders = ref<Set<Provider>>(new Set());
function providerCount(p: Provider): number {
  return sessions.value.filter((s) => s.provider === p).length;
}
function toggleProvider(p: Provider) {
  const next = new Set(activeProviders.value);
  next.has(p) ? next.delete(p) : next.add(p);
  activeProviders.value = next;
}
function providerVisible(p: Provider): boolean {
  return activeProviders.value.size === 0 || activeProviders.value.has(p);
}

const activeStatuses = ref<Set<SessionStatus>>(new Set());
const STATUS_LIST = Object.values(STATUS);
function statusCount(k: SessionStatus): number {
  return sessions.value.filter((s) => s.status === k).length;
}
function toggleStatus(k: SessionStatus) {
  const next = new Set(activeStatuses.value);
  next.has(k) ? next.delete(k) : next.add(k);
  activeStatuses.value = next;
}
function statusVisible(k: SessionStatus): boolean {
  return activeStatuses.value.size === 0 || activeStatuses.value.has(k);
}

const selectedProject = ref("");
interface ProjectEntry {
  key: string;
  name: string;
  path: string;
  count: number;
}
const projects = computed<ProjectEntry[]>(() => {
  const map = new Map<string, ProjectEntry>();
  for (const s of sessions.value) {
    if (!providerVisible(s.provider) || !statusVisible(s.status)) continue;
    const key = projectKey(s);
    const existing = map.get(key);
    if (existing) existing.count++;
    else map.set(key, { key, name: projectName(s), path: tildePath(key), count: 1 });
  }
  return [...map.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path)
  );
});

watch(projects, (list) => {
  if (selectedProject.value !== "" && !list.some((p) => p.key === selectedProject.value)) {
    selectedProject.value = "";
  }
});

const visibleSessions = computed(() =>
  sessions.value.filter(
    (s) =>
      providerVisible(s.provider) &&
      statusVisible(s.status) &&
      (selectedProject.value === "" || projectKey(s) === selectedProject.value)
  )
);
const liveCount = computed(() => visibleSessions.value.filter((s) => s.active).length);

function cardsFor(colId: string): Session[] {
  return visibleSessions.value.filter((s) => columnIdOf(s, columns.value) === colId);
}

// --- Drag & drop: cards move between columns, headers reorder columns ---
async function onDrop(colId: string) {
  const cardId = dragId.value;
  const colSrc = dragColId.value;
  dragId.value = null;
  dragColId.value = null;
  dropColId.value = null;

  if (colSrc) return reorderTo(colSrc, colId);
  if (!cardId) return;

  const col = columns.value.find((c) => c.id === colId);
  if (!col) return;
  // Auto columns clear the manual pin; manual columns set it.
  await patchState(cardId, { column: col.rule === null ? colId : null });
  await load();
}

async function reorderTo(srcId: string, targetId: string) {
  if (srcId === targetId) return;
  const ids = columns.value.map((c) => c.id);
  ids.splice(ids.indexOf(srcId), 1);
  ids.splice(ids.indexOf(targetId), 0, srcId); // insert before target
  await reorderColumns(ids);
  await load();
}

// --- Column CRUD ---
async function addColumn() {
  const label = window.prompt("Nombre de la nueva columna")?.trim();
  if (!label) return;
  await createColumn(label);
  await load();
}
async function renameCol(col: BoardColumn) {
  const label = window.prompt("Renombrar columna", col.label)?.trim();
  if (!label || label === col.label) return;
  await renameColumn(col.id, label);
  await load();
}
async function removeCol(col: BoardColumn) {
  const msg = `¿Eliminar "${col.label}"? Las sesiones fijadas vuelven a su columna automática.`;
  if (!window.confirm(msg)) return;
  await deleteColumn(col.id);
  await load();
}

// --- Drawer ---
async function openDrawer(s: Session) {
  selected.value = s;
  notesDraft.value = s.state.notes;
  if (s.state.lastReadAt === "" || s.lastActivity > s.state.lastReadAt) {
    await patchState(s.id, { lastReadAt: s.lastActivity });
    await load();
  }
}
async function saveNotes() {
  if (!selected.value) return;
  await patchState(selected.value.id, { notes: notesDraft.value });
  await load();
}
</script>

<template>
  <div class="topbar">
    <span class="dot" />
    <h1>Agent Board</h1>
    <div class="filters">
      <button
        v-for="p in PROVIDERS"
        :key="p.key"
        class="pill"
        :class="{ on: activeProviders.has(p.key) }"
        @click="toggleProvider(p.key)"
      >
        <span class="pdot" :style="{ background: p.color }" />
        {{ p.label }}
        <span class="pcount">{{ providerCount(p.key) }}</span>
      </button>
    </div>
    <div class="filters">
      <button
        v-for="st in STATUS_LIST"
        :key="st.key"
        class="pill"
        :class="{ on: activeStatuses.has(st.key) }"
        @click="toggleStatus(st.key)"
      >
        <span class="pdot" :style="{ background: st.color }" />
        {{ st.label }}
        <span class="pcount">{{ statusCount(st.key) }}</span>
      </button>
    </div>
    <select v-model="selectedProject" class="proj-select">
      <option value="">Todos los proyectos ({{ projects.reduce((n, p) => n + p.count, 0) }})</option>
      <option v-for="p in projects" :key="p.key" :value="p.key">
        {{ p.name }} · {{ p.path }} ({{ p.count }})
      </option>
    </select>
    <div class="spacer" />
    <span class="meta">{{ liveCount }} activas · {{ visibleSessions.length }} visibles</span>
  </div>

  <div v-if="loading" class="board"><span class="meta" style="padding:16px">Cargando…</span></div>

  <div v-else class="board">
    <div
      v-for="col in columns"
      :key="col.id"
      class="col"
      :class="{ drop: dropColId === col.id }"
      @dragover.prevent="dropColId = col.id"
      @dragleave="dropColId = dropColId === col.id ? null : dropColId"
      @drop.prevent="onDrop(col.id)"
    >
      <div
        class="col-head"
        draggable="true"
        @dragstart="dragColId = col.id"
        @dragend="dragColId = null"
      >
        <span class="col-title" @dblclick.stop="renameCol(col)" title="Doble clic para renombrar">
          <span v-if="col.rule" class="auto-badge" title="Columna automática">auto</span>
          {{ col.label }}
        </span>
        <span class="col-actions">
          <span class="count">{{ cardsFor(col.id).length }}</span>
          <button class="col-x" title="Eliminar columna" @click.stop="removeCol(col)">×</button>
        </span>
      </div>
      <div class="col-body">
        <Card
          v-for="s in cardsFor(col.id)"
          :key="s.id"
          :session="s"
          @dragstart="dragId = $event"
          @open="openDrawer"
        />
      </div>
    </div>

    <button class="add-col" @click="addColumn">+ Columna</button>
  </div>

  <div v-if="selected" class="drawer">
    <button class="close" @click="selected = null">×</button>
    <h2>{{ selected.title }}</h2>
    <p class="k">{{ selected.projectPath || selected.projectSlug }}</p>
    <p class="k">{{ selected.messageCount }} mensajes · {{ selected.id }}</p>
    <p style="font-size:13px; line-height:1.4">{{ selected.preview }}</p>
    <hr style="border-color:var(--border)" />
    <p class="k">Notas (solo en esta app)</p>
    <textarea v-model="notesDraft" placeholder="Notas sobre esta sesión…" />
    <div style="margin-top:8px; display:flex; gap:8px">
      <button class="btn" @click="saveNotes">Guardar notas</button>
      <button class="btn ghost" @click="notesDraft = selected.state.notes">Descartar</button>
    </div>
  </div>
</template>
