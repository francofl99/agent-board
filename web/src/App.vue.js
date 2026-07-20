import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import Card from "./components/Card.vue";
import { createColumn, deleteColumn, fetchColumns, fetchSessions, patchState, renameColumn, reorderColumns, subscribe, } from "./api";
import { columnIdOf, projectKey, projectName, PROVIDERS, STATUS, tildePath, } from "./types";
const sessions = ref([]);
const columns = ref([]);
const loading = ref(true);
const dragId = ref(null); // session being dragged
const dragColId = ref(null); // column being reordered
const dropColId = ref(null); // column under the cursor
const selected = ref(null);
const notesDraft = ref("");
let unsub = null;
async function load() {
    const [ss, cols] = await Promise.all([fetchSessions(), fetchColumns()]);
    sessions.value = ss;
    columns.value = cols.slice().sort((a, b) => a.position - b.position);
    loading.value = false;
    if (selected.value) {
        const fresh = sessions.value.find((s) => s.id === selected.value.id);
        if (fresh)
            selected.value = fresh;
    }
}
onMounted(async () => {
    await load();
    unsub = subscribe(load);
});
onUnmounted(() => unsub?.());
// --- Filters (provider / project / status) ---
const activeProviders = ref(new Set());
function providerCount(p) {
    return sessions.value.filter((s) => s.provider === p).length;
}
function toggleProvider(p) {
    const next = new Set(activeProviders.value);
    next.has(p) ? next.delete(p) : next.add(p);
    activeProviders.value = next;
}
function providerVisible(p) {
    return activeProviders.value.size === 0 || activeProviders.value.has(p);
}
const activeStatuses = ref(new Set());
const STATUS_LIST = Object.values(STATUS);
function statusCount(k) {
    return sessions.value.filter((s) => s.status === k).length;
}
function toggleStatus(k) {
    const next = new Set(activeStatuses.value);
    next.has(k) ? next.delete(k) : next.add(k);
    activeStatuses.value = next;
}
function statusVisible(k) {
    return activeStatuses.value.size === 0 || activeStatuses.value.has(k);
}
const selectedProject = ref("");
const projects = computed(() => {
    const map = new Map();
    for (const s of sessions.value) {
        if (!providerVisible(s.provider) || !statusVisible(s.status))
            continue;
        const key = projectKey(s);
        const existing = map.get(key);
        if (existing)
            existing.count++;
        else
            map.set(key, { key, name: projectName(s), path: tildePath(key), count: 1 });
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
});
watch(projects, (list) => {
    if (selectedProject.value !== "" && !list.some((p) => p.key === selectedProject.value)) {
        selectedProject.value = "";
    }
});
const visibleSessions = computed(() => sessions.value.filter((s) => providerVisible(s.provider) &&
    statusVisible(s.status) &&
    (selectedProject.value === "" || projectKey(s) === selectedProject.value)));
const liveCount = computed(() => visibleSessions.value.filter((s) => s.active).length);
function cardsFor(colId) {
    return visibleSessions.value.filter((s) => columnIdOf(s, columns.value) === colId);
}
// --- Drag & drop: cards move between columns, headers reorder columns ---
async function onDrop(colId) {
    const cardId = dragId.value;
    const colSrc = dragColId.value;
    dragId.value = null;
    dragColId.value = null;
    dropColId.value = null;
    if (colSrc)
        return reorderTo(colSrc, colId);
    if (!cardId)
        return;
    const col = columns.value.find((c) => c.id === colId);
    if (!col)
        return;
    // Auto columns clear the manual pin; manual columns set it.
    await patchState(cardId, { column: col.rule === null ? colId : null });
    await load();
}
async function reorderTo(srcId, targetId) {
    if (srcId === targetId)
        return;
    const ids = columns.value.map((c) => c.id);
    ids.splice(ids.indexOf(srcId), 1);
    ids.splice(ids.indexOf(targetId), 0, srcId); // insert before target
    await reorderColumns(ids);
    await load();
}
// --- Column CRUD ---
async function addColumn() {
    const label = window.prompt("Nombre de la nueva columna")?.trim();
    if (!label)
        return;
    await createColumn(label);
    await load();
}
async function renameCol(col) {
    const label = window.prompt("Renombrar columna", col.label)?.trim();
    if (!label || label === col.label)
        return;
    await renameColumn(col.id, label);
    await load();
}
async function removeCol(col) {
    const msg = `¿Eliminar "${col.label}"? Las sesiones fijadas vuelven a su columna automática.`;
    if (!window.confirm(msg))
        return;
    await deleteColumn(col.id);
    await load();
}
// --- Drawer ---
async function openDrawer(s) {
    selected.value = s;
    notesDraft.value = s.state.notes;
    if (s.state.lastReadAt === "" || s.lastActivity > s.state.lastReadAt) {
        await patchState(s.id, { lastReadAt: s.lastActivity });
        await load();
    }
}
async function saveNotes() {
    if (!selected.value)
        return;
    await patchState(selected.value.id, { notes: notesDraft.value });
    await load();
}
debugger; /* PartiallyEnd: #3632/scriptSetup.vue */
const __VLS_ctx = {};
let __VLS_components;
let __VLS_directives;
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "topbar" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.span)({
    ...{ class: "dot" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.h1, __VLS_intrinsicElements.h1)({});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "filters" },
});
for (const [p] of __VLS_getVForSourceType((__VLS_ctx.PROVIDERS))) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
        ...{ onClick: (...[$event]) => {
                __VLS_ctx.toggleProvider(p.key);
            } },
        key: (p.key),
        ...{ class: "pill" },
        ...{ class: ({ on: __VLS_ctx.activeProviders.has(p.key) }) },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span)({
        ...{ class: "pdot" },
        ...{ style: ({ background: p.color }) },
    });
    (p.label);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "pcount" },
    });
    (__VLS_ctx.providerCount(p.key));
}
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "filters" },
});
for (const [st] of __VLS_getVForSourceType((__VLS_ctx.STATUS_LIST))) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
        ...{ onClick: (...[$event]) => {
                __VLS_ctx.toggleStatus(st.key);
            } },
        key: (st.key),
        ...{ class: "pill" },
        ...{ class: ({ on: __VLS_ctx.activeStatuses.has(st.key) }) },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span)({
        ...{ class: "pdot" },
        ...{ style: ({ background: st.color }) },
    });
    (st.label);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "pcount" },
    });
    (__VLS_ctx.statusCount(st.key));
}
__VLS_asFunctionalElement(__VLS_intrinsicElements.select, __VLS_intrinsicElements.select)({
    value: (__VLS_ctx.selectedProject),
    ...{ class: "proj-select" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.option, __VLS_intrinsicElements.option)({
    value: "",
});
(__VLS_ctx.projects.reduce((n, p) => n + p.count, 0));
for (const [p] of __VLS_getVForSourceType((__VLS_ctx.projects))) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.option, __VLS_intrinsicElements.option)({
        key: (p.key),
        value: (p.key),
    });
    (p.name);
    (p.path);
    (p.count);
}
__VLS_asFunctionalElement(__VLS_intrinsicElements.div)({
    ...{ class: "spacer" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
    ...{ class: "meta" },
});
(__VLS_ctx.liveCount);
(__VLS_ctx.visibleSessions.length);
if (__VLS_ctx.loading) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "board" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "meta" },
        ...{ style: {} },
    });
}
else {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "board" },
    });
    for (const [col] of __VLS_getVForSourceType((__VLS_ctx.columns))) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ onDragover: (...[$event]) => {
                    if (!!(__VLS_ctx.loading))
                        return;
                    __VLS_ctx.dropColId = col.id;
                } },
            ...{ onDragleave: (...[$event]) => {
                    if (!!(__VLS_ctx.loading))
                        return;
                    __VLS_ctx.dropColId = __VLS_ctx.dropColId === col.id ? null : __VLS_ctx.dropColId;
                } },
            ...{ onDrop: (...[$event]) => {
                    if (!!(__VLS_ctx.loading))
                        return;
                    __VLS_ctx.onDrop(col.id);
                } },
            key: (col.id),
            ...{ class: "col" },
            ...{ class: ({ drop: __VLS_ctx.dropColId === col.id }) },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ onDragstart: (...[$event]) => {
                    if (!!(__VLS_ctx.loading))
                        return;
                    __VLS_ctx.dragColId = col.id;
                } },
            ...{ onDragend: (...[$event]) => {
                    if (!!(__VLS_ctx.loading))
                        return;
                    __VLS_ctx.dragColId = null;
                } },
            ...{ class: "col-head" },
            draggable: "true",
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ onDblclick: (...[$event]) => {
                    if (!!(__VLS_ctx.loading))
                        return;
                    __VLS_ctx.renameCol(col);
                } },
            ...{ class: "col-title" },
            title: "Doble clic para renombrar",
        });
        if (col.rule) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "auto-badge" },
                title: "Columna automática",
            });
        }
        (col.label);
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "col-actions" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "count" },
        });
        (__VLS_ctx.cardsFor(col.id).length);
        __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
            ...{ onClick: (...[$event]) => {
                    if (!!(__VLS_ctx.loading))
                        return;
                    __VLS_ctx.removeCol(col);
                } },
            ...{ class: "col-x" },
            title: "Eliminar columna",
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "col-body" },
        });
        for (const [s] of __VLS_getVForSourceType((__VLS_ctx.cardsFor(col.id)))) {
            /** @type {[typeof Card, ]} */ ;
            // @ts-ignore
            const __VLS_0 = __VLS_asFunctionalComponent(Card, new Card({
                ...{ 'onDragstart': {} },
                ...{ 'onOpen': {} },
                key: (s.id),
                session: (s),
            }));
            const __VLS_1 = __VLS_0({
                ...{ 'onDragstart': {} },
                ...{ 'onOpen': {} },
                key: (s.id),
                session: (s),
            }, ...__VLS_functionalComponentArgsRest(__VLS_0));
            let __VLS_3;
            let __VLS_4;
            let __VLS_5;
            const __VLS_6 = {
                onDragstart: (...[$event]) => {
                    if (!!(__VLS_ctx.loading))
                        return;
                    __VLS_ctx.dragId = $event;
                }
            };
            const __VLS_7 = {
                onOpen: (__VLS_ctx.openDrawer)
            };
            var __VLS_2;
        }
    }
    __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
        ...{ onClick: (__VLS_ctx.addColumn) },
        ...{ class: "add-col" },
    });
}
if (__VLS_ctx.selected) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "drawer" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
        ...{ onClick: (...[$event]) => {
                if (!(__VLS_ctx.selected))
                    return;
                __VLS_ctx.selected = null;
            } },
        ...{ class: "close" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.h2, __VLS_intrinsicElements.h2)({});
    (__VLS_ctx.selected.title);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({
        ...{ class: "k" },
    });
    (__VLS_ctx.selected.projectPath || __VLS_ctx.selected.projectSlug);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({
        ...{ class: "k" },
    });
    (__VLS_ctx.selected.messageCount);
    (__VLS_ctx.selected.id);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({
        ...{ style: {} },
    });
    (__VLS_ctx.selected.preview);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.hr)({
        ...{ style: {} },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({
        ...{ class: "k" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.textarea)({
        value: (__VLS_ctx.notesDraft),
        placeholder: "Notas sobre esta sesión…",
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ style: {} },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
        ...{ onClick: (__VLS_ctx.saveNotes) },
        ...{ class: "btn" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
        ...{ onClick: (...[$event]) => {
                if (!(__VLS_ctx.selected))
                    return;
                __VLS_ctx.notesDraft = __VLS_ctx.selected.state.notes;
            } },
        ...{ class: "btn ghost" },
    });
}
/** @type {__VLS_StyleScopedClasses['topbar']} */ ;
/** @type {__VLS_StyleScopedClasses['dot']} */ ;
/** @type {__VLS_StyleScopedClasses['filters']} */ ;
/** @type {__VLS_StyleScopedClasses['pill']} */ ;
/** @type {__VLS_StyleScopedClasses['pdot']} */ ;
/** @type {__VLS_StyleScopedClasses['pcount']} */ ;
/** @type {__VLS_StyleScopedClasses['filters']} */ ;
/** @type {__VLS_StyleScopedClasses['pill']} */ ;
/** @type {__VLS_StyleScopedClasses['pdot']} */ ;
/** @type {__VLS_StyleScopedClasses['pcount']} */ ;
/** @type {__VLS_StyleScopedClasses['proj-select']} */ ;
/** @type {__VLS_StyleScopedClasses['spacer']} */ ;
/** @type {__VLS_StyleScopedClasses['meta']} */ ;
/** @type {__VLS_StyleScopedClasses['board']} */ ;
/** @type {__VLS_StyleScopedClasses['meta']} */ ;
/** @type {__VLS_StyleScopedClasses['board']} */ ;
/** @type {__VLS_StyleScopedClasses['col']} */ ;
/** @type {__VLS_StyleScopedClasses['col-head']} */ ;
/** @type {__VLS_StyleScopedClasses['col-title']} */ ;
/** @type {__VLS_StyleScopedClasses['auto-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['col-actions']} */ ;
/** @type {__VLS_StyleScopedClasses['count']} */ ;
/** @type {__VLS_StyleScopedClasses['col-x']} */ ;
/** @type {__VLS_StyleScopedClasses['col-body']} */ ;
/** @type {__VLS_StyleScopedClasses['add-col']} */ ;
/** @type {__VLS_StyleScopedClasses['drawer']} */ ;
/** @type {__VLS_StyleScopedClasses['close']} */ ;
/** @type {__VLS_StyleScopedClasses['k']} */ ;
/** @type {__VLS_StyleScopedClasses['k']} */ ;
/** @type {__VLS_StyleScopedClasses['k']} */ ;
/** @type {__VLS_StyleScopedClasses['btn']} */ ;
/** @type {__VLS_StyleScopedClasses['btn']} */ ;
/** @type {__VLS_StyleScopedClasses['ghost']} */ ;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup() {
        return {
            Card: Card,
            PROVIDERS: PROVIDERS,
            columns: columns,
            loading: loading,
            dragId: dragId,
            dragColId: dragColId,
            dropColId: dropColId,
            selected: selected,
            notesDraft: notesDraft,
            activeProviders: activeProviders,
            providerCount: providerCount,
            toggleProvider: toggleProvider,
            activeStatuses: activeStatuses,
            STATUS_LIST: STATUS_LIST,
            statusCount: statusCount,
            toggleStatus: toggleStatus,
            selectedProject: selectedProject,
            projects: projects,
            visibleSessions: visibleSessions,
            liveCount: liveCount,
            cardsFor: cardsFor,
            onDrop: onDrop,
            addColumn: addColumn,
            renameCol: renameCol,
            removeCol: removeCol,
            openDrawer: openDrawer,
            saveNotes: saveNotes,
        };
    },
});
export default (await import('vue')).defineComponent({
    setup() {
        return {};
    },
});
; /* PartiallyEnd: #4569/main.vue */
