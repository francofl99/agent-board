import { isUnread, projectName, providerMeta, STATUS } from "../types";
const props = defineProps();
const emit = defineEmits();
function ago(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.round(diff / 60000);
    if (m < 1)
        return "recién";
    if (m < 60)
        return `${m}m`;
    const h = Math.round(m / 60);
    if (h < 24)
        return `${h}h`;
    return `${Math.round(h / 24)}d`;
}
debugger; /* PartiallyEnd: #3632/scriptSetup.vue */
const __VLS_ctx = {};
let __VLS_components;
let __VLS_directives;
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ onDragstart: (...[$event]) => {
            __VLS_ctx.emit('dragstart', props.session.id);
        } },
    ...{ onClick: (...[$event]) => {
            __VLS_ctx.emit('open', props.session);
        } },
    ...{ class: "card" },
    ...{ class: ({ live: props.session.active, unread: __VLS_ctx.isUnread(props.session) }) },
    draggable: "true",
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "title" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.span)({
    ...{ class: "prov-dot" },
    ...{ style: ({ background: __VLS_ctx.providerMeta(props.session.provider).color }) },
    title: (__VLS_ctx.providerMeta(props.session.provider).label),
});
if (__VLS_ctx.isUnread(props.session)) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span)({
        ...{ class: "unread-dot" },
        title: "Sin leer",
    });
}
(props.session.title);
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "status" },
    ...{ style: ({ color: __VLS_ctx.STATUS[props.session.status].color }) },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.span)({
    ...{ class: "status-dot" },
    ...{ class: ({ pulse: props.session.status === 'working' }) },
    ...{ style: ({ background: __VLS_ctx.STATUS[props.session.status].color }) },
});
(__VLS_ctx.STATUS[props.session.status].label);
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "preview" },
});
(props.session.preview);
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "row" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
    ...{ class: "tag prov" },
    ...{ style: ({ color: __VLS_ctx.providerMeta(props.session.provider).color }) },
});
(__VLS_ctx.providerMeta(props.session.provider).label);
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
    ...{ class: "tag" },
});
(__VLS_ctx.projectName(props.session));
if (props.session.gitBranch) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "tag" },
    });
    (props.session.gitBranch);
}
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
(props.session.messageCount);
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
(__VLS_ctx.ago(props.session.lastActivity));
if (props.session.state.notes) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "notes-mark" },
    });
}
/** @type {__VLS_StyleScopedClasses['card']} */ ;
/** @type {__VLS_StyleScopedClasses['title']} */ ;
/** @type {__VLS_StyleScopedClasses['prov-dot']} */ ;
/** @type {__VLS_StyleScopedClasses['unread-dot']} */ ;
/** @type {__VLS_StyleScopedClasses['status']} */ ;
/** @type {__VLS_StyleScopedClasses['status-dot']} */ ;
/** @type {__VLS_StyleScopedClasses['preview']} */ ;
/** @type {__VLS_StyleScopedClasses['row']} */ ;
/** @type {__VLS_StyleScopedClasses['tag']} */ ;
/** @type {__VLS_StyleScopedClasses['prov']} */ ;
/** @type {__VLS_StyleScopedClasses['tag']} */ ;
/** @type {__VLS_StyleScopedClasses['tag']} */ ;
/** @type {__VLS_StyleScopedClasses['notes-mark']} */ ;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup() {
        return {
            isUnread: isUnread,
            projectName: projectName,
            providerMeta: providerMeta,
            STATUS: STATUS,
            emit: emit,
            ago: ago,
        };
    },
    __typeEmits: {},
    __typeProps: {},
});
export default (await import('vue')).defineComponent({
    setup() {
        return {};
    },
    __typeEmits: {},
    __typeProps: {},
});
; /* PartiallyEnd: #4569/main.vue */
