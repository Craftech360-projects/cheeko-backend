<template>
  <el-dialog
    :visible="visible"
    width="480px"
    class="rfid-dialog-wrapper"
    :append-to-body="true"
    custom-class="custom-rfid-dialog"
    :show-close="false"
    @open="loadSiblings"
    @close="close"
  >
    <div v-if="card" class="dialog-container">
      <div class="dialog-header">
        <div class="header-text">
          <div class="eyebrow">RFID card</div>
          <h2 class="dialog-title mono">{{ card.rfidUid }}</h2>
        </div>
        <button class="custom-close-btn" aria-label="Close" @click="close">
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M13 1L1 13M1 1L13 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          </svg>
        </button>
      </div>

      <div class="dialog-body">
        <dl class="facts">
          <div class="fact">
            <dt>Card type</dt>
            <dd>{{ typeLabel }}</dd>
          </div>
          <div class="fact">
            <dt>Assigned to</dt>
            <dd>
              <template v-if="assignedTo">
                {{ assignedTo.name }}
                <span v-if="assignedTo.code" class="mono muted">· {{ assignedTo.code }}</span>
              </template>
              <span v-else class="muted">Nothing</span>
            </dd>
          </div>
          <div v-if="card.packId" class="fact">
            <dt>Product SKU</dt>
            <dd>{{ skuName }}</dd>
          </div>
          <div class="fact">
            <dt>Status</dt>
            <dd :class="{ live: card.active }">{{ card.active ? 'Active' : 'Inactive' }}</dd>
          </div>
        </dl>

        <div v-if="card.contentPackId" class="siblings">
          <div class="siblings-head">
            <span class="field-label">Other cards on this pack</span>
            <span class="mono muted">{{ siblingCount }}</span>
          </div>
          <div v-if="loading" class="siblings-empty">Loading…</div>
          <div v-else-if="siblings.length === 0" class="siblings-empty">This is the only card on this pack.</div>
          <div v-else class="uid-grid">
            <span v-for="c in siblings" :key="c.id" class="uid-chip"
              :class="{ inactive: !c.active }" :title="c.active ? '' : 'Inactive'">{{ c.rfidUid }}</span>
          </div>
          <div v-if="siblingTotal > siblings.length + 1" class="field-hint">Showing {{ siblings.length }} of {{ siblingCount }}.</div>
        </div>
      </div>

      <div class="dialog-footer">
        <el-button size="small" @click="close">Close</el-button>
        <el-button size="small" type="primary" @click="$emit('edit', card)">Edit mapping</el-button>
      </div>
    </div>
  </el-dialog>
</template>

<script>
import Api from '@/apis/api';

const LIST_LIMIT = 1000;

export default {
  name: 'RfidCardDetailDialog',
  props: {
    visible: { type: Boolean, default: false },
    card: { type: Object, default: null },
    contentPacks: { type: Array, default: () => [] },
    questionPacks: { type: Array, default: () => [] },
    packs: { type: Array, default: () => [] }
  },
  data() {
    return { loading: false, siblings: [], siblingTotal: 0 };
  },
  computed: {
    // Same precedence as the Content Type column in the Card Mappings table.
    typeLabel() {
      const c = this.card;
      if (c.cardType === 'ai') return 'AI Card';
      if (c.cardType === 'game') return 'Game Card';
      if (c.contentPackId) return 'Story / Rhyme';
      if (c.questionPackId) return 'Q&A Pack';
      if ((c.questionIds && c.questionIds.length) || c.questionId) return 'AI Prompt';
      return 'Unmapped';
    },
    assignedTo() {
      const c = this.card;
      if (c.contentPackId) {
        const p = this.contentPacks.find(p => p.id === c.contentPackId);
        return { name: p ? p.name : `Pack #${c.contentPackId}`, code: p && p.packCode };
      }
      if (c.questionPackId) {
        const p = this.questionPacks.find(p => p.id === c.questionPackId);
        return { name: p ? p.name : `Q&A pack #${c.questionPackId}`, code: p && p.packCode };
      }
      if (c.cardType === 'ai') {
        return { name: (c.actionData && c.actionData.agent_name) || 'Cheeko', code: null };
      }
      const prompts = (c.questionIds && c.questionIds.length) || (c.questionId ? 1 : 0);
      return prompts ? { name: `${prompts} prompt${prompts === 1 ? '' : 's'}`, code: null } : null;
    },
    skuName() {
      const p = this.packs.find(p => p.id === this.card.packId);
      return p ? p.name : `#${this.card.packId}`;
    },
    // The total counts this card too; the list leaves it out.
    siblingCount() {
      return Math.max(this.siblingTotal - 1, 0);
    }
  },
  methods: {
    loadSiblings() {
      this.siblings = [];
      this.siblingTotal = 0;
      const card = this.card;
      if (!card || !card.contentPackId) return;
      this.loading = true;
      Api.rfid.getCardPage({ page: 1, limit: LIST_LIMIT, contentPackId: card.contentPackId }, ({ data }) => {
        if (this.card !== card) return;
        this.loading = false;
        const page = data.code === 0 && data.data ? data.data : { list: [], total: 0 };
        this.siblings = (page.list || []).filter(c => c.rfidUid !== card.rfidUid);
        this.siblingTotal = page.total || 0;
      });
    },
    close() {
      this.$emit('update:visible', false);
    }
  }
};
</script>

<style scoped lang="scss">
@import '@/styles/theme.scss';

.rfid-dialog-wrapper {
  .dialog-container { background: $surface; }

  .dialog-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    padding: 18px 24px;
    border-bottom: 1px solid $border-color;
  }
  .eyebrow {
    font-family: $font-mono;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.11em;
    color: $text-light;
    margin-bottom: 6px;
  }
  .dialog-title {
    font-size: 20px;
    font-weight: 500;
    color: $text-dark;
    margin: 0;
  }
  .custom-close-btn {
    width: 28px;
    height: 28px;
    border-radius: $radius-sm;
    border: none;
    background: transparent;
    color: $text-light;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    transition: background 0.15s, color 0.15s;
    &:hover { background: $surface-sunk; color: $text-dark; }
  }

  .dialog-body {
    padding: 8px 24px 20px;
    max-height: 64vh;
    overflow-y: auto;
  }

  .dialog-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 14px 24px;
    border-top: 1px solid $border-color;
  }
}

.mono {
  font-family: $font-mono;
  letter-spacing: 0.04em;
}
.muted { color: $text-light; }

.facts { margin: 0; }
.fact {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid $border-color;

  dt {
    font-family: $font-mono;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.11em;
    color: $text-light;
    padding-top: 2px;
  }
  dd {
    margin: 0;
    font-size: 13.5px;
    color: $text-dark;
    word-break: break-word;
    &.live { color: $success; }
  }
}

.field-label {
  font-family: $font-mono;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.11em;
  color: $text-light;
}
.field-hint {
  font-size: 11.5px;
  color: $text-light;
  margin-top: 8px;
}

.siblings { margin-top: 20px; }
.siblings-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 10px;
  .mono { font-size: 11px; }
}
.siblings-empty {
  font-size: 12.5px;
  color: $text-light;
}
.uid-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 180px;
  overflow-y: auto;
}
.uid-chip {
  font-family: $font-mono;
  font-size: 11.5px;
  letter-spacing: 0.04em;
  color: $text-body;
  padding: 3px 8px;
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  background: $surface;

  &.inactive { color: $text-light; text-decoration: line-through; }
}
</style>
