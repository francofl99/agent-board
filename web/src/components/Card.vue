<script setup lang="ts">
import { isUnread, projectName, providerMeta, STATUS, type Session } from "../types";

const props = defineProps<{ session: Session }>();
const emit = defineEmits<{
  (e: "open", s: Session): void;
  (e: "dragstart", id: string): void;
}>();

function ago(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "recién";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}
</script>

<template>
  <div
    class="card"
    :class="{ live: props.session.active, unread: isUnread(props.session) }"
    draggable="true"
    @dragstart="emit('dragstart', props.session.id)"
    @click="emit('open', props.session)"
  >
    <div class="title">
      <span
        class="prov-dot"
        :style="{ background: providerMeta(props.session.provider).color }"
        :title="providerMeta(props.session.provider).label"
      />
      <span v-if="isUnread(props.session)" class="unread-dot" title="Sin leer" />
      {{ props.session.title }}
    </div>
    <div class="status" :style="{ color: STATUS[props.session.status].color }">
      <span
        class="status-dot"
        :class="{ pulse: props.session.status === 'working' }"
        :style="{ background: STATUS[props.session.status].color }"
      />
      {{ STATUS[props.session.status].label }}
    </div>
    <div class="preview">{{ props.session.preview }}</div>
    <div class="row">
      <span class="tag prov" :style="{ color: providerMeta(props.session.provider).color }">
        {{ providerMeta(props.session.provider).label }}
      </span>
      <span class="tag">{{ projectName(props.session) }}</span>
      <span v-if="props.session.gitBranch" class="tag">⎇ {{ props.session.gitBranch }}</span>
      <span>{{ props.session.messageCount }} msg</span>
      <span>· {{ ago(props.session.lastActivity) }}</span>
      <span v-if="props.session.state.notes" class="notes-mark">· ✎ notas</span>
    </div>
  </div>
</template>
