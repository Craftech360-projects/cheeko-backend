<template>
  <el-dialog
    :visible="visible"
    width="520px"
    class="rfid-dialog-wrapper"
    :append-to-body="true"
    :close-on-click-modal="!input.trim()"
    custom-class="custom-rfid-dialog"
    :show-close="false"
    @open="onOpen"
    @close="close"
  >
    <div v-if="pack" class="dialog-container">
      <div class="dialog-header">
        <div class="header-text">
          <h2 class="dialog-title">Assign cards</h2>
          <div class="header-sub">{{ pack.name }} <span class="mono">· {{ pack.packCode }}</span></div>
        </div>
        <button class="custom-close-btn" aria-label="Close" @click="close">
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M13 1L1 13M1 1L13 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          </svg>
        </button>
      </div>

      <div class="dialog-body">
        <label class="field-label" for="assign-uids">Card UIDs</label>
        <el-input
          id="assign-uids"
          v-model="input"
          type="textarea"
          :rows="4"
          resize="none"
          class="uid-textarea"
          placeholder="7941AE0D, 29994A0E, 99273D0E"
          @keydown.native.meta.enter="submit"
          @keydown.native.ctrl.enter="submit"
        />
        <div class="field-hint">
          Separate with commas. A card already on another pack is moved here.
          <span v-if="parsedUids.length" class="count">{{ parsedUids.length }} UID{{ parsedUids.length === 1 ? '' : 's' }}</span>
        </div>

        <div v-if="result" class="result" role="status">
          <div v-if="result.added.length" class="result-row">
            <span class="result-label">Added</span>
            <span class="mono">{{ result.added.join(', ') }}</span>
          </div>
          <div v-if="result.moved.length" class="result-row">
            <span class="result-label">Moved</span>
            <span>
              <span v-for="m in result.moved" :key="m.rfidUid" class="moved-item">
                <span class="mono">{{ m.rfidUid }}</span>
                <span class="muted"> from {{ m.fromName || 'another mapping' }}</span>
              </span>
            </span>
          </div>
          <div v-if="result.unchanged.length" class="result-row">
            <span class="result-label">Already here</span>
            <span class="mono muted">{{ result.unchanged.join(', ') }}</span>
          </div>
          <div v-if="result.invalid.length" class="result-row is-danger">
            <span class="result-label">Not a UID</span>
            <span class="mono">{{ result.invalid.join(', ') }}</span>
          </div>
        </div>

        <div class="assigned">
          <div class="assigned-head">
            <span class="field-label">On this pack</span>
            <span class="mono muted">{{ assignedTotal }}</span>
          </div>
          <div v-if="loading" class="assigned-empty">Loading…</div>
          <div v-else-if="assigned.length === 0" class="assigned-empty">No cards assigned yet.</div>
          <div v-else class="uid-grid">
            <span v-for="c in assigned" :key="c.id" class="uid-chip"
              :class="{ fresh: freshUids.includes(c.rfidUid), inactive: !c.active }"
              :title="c.active ? '' : 'Inactive'">{{ c.rfidUid }}</span>
          </div>
          <div v-if="assignedTotal > assigned.length" class="field-hint">Showing {{ assigned.length }} of {{ assignedTotal }}.</div>
        </div>
      </div>

      <div class="dialog-footer">
        <el-button size="small" @click="close">Done</el-button>
        <el-button size="small" type="primary" :loading="saving" :disabled="!parsedUids.length" @click="submit">
          Assign{{ parsedUids.length ? ` ${parsedUids.length}` : '' }}
        </el-button>
      </div>
    </div>
  </el-dialog>
</template>

<script>
import Api from '@/apis/api';

const LIST_LIMIT = 1000;

export default {
  name: 'RfidAssignCardsDialog',
  props: {
    visible: { type: Boolean, default: false },
    pack: { type: Object, default: null }
  },
  data() {
    return {
      input: '',
      saving: false,
      loading: false,
      assigned: [],
      assignedTotal: 0,
      result: null,
      freshUids: []
    };
  },
  computed: {
    // What the server will see: split on commas (and newlines, for pasted
    // columns), trimmed, same-UID duplicates collapsed.
    parsedUids() {
      const seen = new Set();
      return this.input.split(/[,\n]+/).map(s => s.trim()).filter(s => {
        const key = s.toUpperCase().replace(/[:\-\s]/g, '');
        if (!s || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
  },
  methods: {
    onOpen() {
      this.input = '';
      this.result = null;
      this.freshUids = [];
      this.assigned = [];
      this.assignedTotal = 0;
      this.loadAssigned();
    },
    loadAssigned() {
      const packId = this.pack && this.pack.id;
      if (!packId) return;
      this.loading = true;
      Api.rfid.getCardPage({ page: 1, limit: LIST_LIMIT, contentPackId: packId }, ({ data }) => {
        if (!this.pack || this.pack.id !== packId) return;
        this.loading = false;
        const page = data.code === 0 && data.data ? data.data : { list: [], total: 0 };
        this.assigned = page.list || [];
        this.assignedTotal = page.total || 0;
      });
    },
    submit() {
      if (!this.parsedUids.length || this.saving) return;
      this.saving = true;
      Api.rfid.assignCardsToContentPack(this.pack.id, this.parsedUids, ({ data }) => {
        this.saving = false;
        if (data.code !== 0) {
          this.$message.error(data.msg || 'Assign failed');
          return;
        }
        this.result = data.data;
        const { added, moved, invalid } = data.data;
        this.freshUids = [...added, ...moved.map(m => m.rfidUid)];
        // Keep anything that didn't go through in the box so it can be fixed.
        this.input = invalid.join(', ');
        if (this.freshUids.length) {
          this.$emit('assigned', data.data);
          this.loadAssigned();
        }
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
  .dialog-title {
    font-family: $font-display;
    font-size: 16px;
    font-weight: 600;
    color: $text-dark;
    margin: 0;
  }
  .header-sub {
    margin-top: 4px;
    font-size: 13px;
    color: $text-gray;
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
    padding: 20px 24px;
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

.field-label {
  display: block;
  font-family: $font-mono;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.11em;
  color: $text-light;
  margin-bottom: 8px;
}
.field-hint {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 11.5px;
  color: $text-light;
  margin-top: 6px;
  line-height: 1.5;
  .count { font-family: $font-mono; color: $text-gray; white-space: nowrap; }
}

.uid-textarea :deep(.el-textarea__inner) {
  border-radius: 6px;
  border: 1px solid $border-color;
  font-family: $font-mono;
  font-size: 13px;
  letter-spacing: 0.04em;
  color: $text-body;
  &:focus { border-color: $text-light; box-shadow: none; }
}

.result {
  margin-top: 16px;
  border-top: 1px solid $border-color;
  padding-top: 12px;
  font-size: 12.5px;
  color: $text-body;
}
.result-row {
  display: grid;
  grid-template-columns: 96px 1fr;
  gap: 12px;
  padding: 4px 0;
  word-break: break-word;
  &.is-danger { color: $danger; }
}
.result-label {
  font-family: $font-mono;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.11em;
  color: $text-light;
  padding-top: 2px;
}
.moved-item { display: block; }

.assigned {
  margin-top: 20px;
  border-top: 1px solid $border-color;
  padding-top: 16px;
}
.assigned-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  .field-label { margin-bottom: 10px; }
  .mono { font-size: 11px; }
}
.assigned-empty {
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

  &.fresh { border-color: $text-dark; color: $text-dark; }
  &.inactive { color: $text-light; text-decoration: line-through; }
}
</style>
