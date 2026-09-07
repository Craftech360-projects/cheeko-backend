/**
 * Backdrop dismissal for dialogs that hold a form.
 *
 * Clicking away should close a dialog you only opened to look at, and must not
 * close one you have been typing into - a modal is the one place in the app
 * where a stray click can destroy work that exists nowhere else yet.
 *
 * Rather than intercepting the click, this drives el-dialog's own
 * `close-on-click-modal`: untouched, the backdrop closes it; edited, the
 * backdrop is inert and Cancel or Esc are the way out. Those two stay
 * available either way, because they are deliberate.
 *
 * Usage:
 *
 *   mixins: [dialogDismiss]
 *   // template: :close-on-click-modal="dismissOnBackdrop"
 *   // on open:  this.markPristine()
 *   // and, when the dialog holds state outside `form`:
 *   methods: { dirtyState() { return { form: this.form, items: this.items }; } }
 */

/**
 * A comparable snapshot. Stable because both sides of the comparison stringify
 * objects built the same way, so key order matches; `undefined` members are
 * normalised so a field that is dropped rather than blanked still compares.
 */
function snapshot(state) {
  try {
    return JSON.stringify(state, (key, value) => (value === undefined ? null : value));
  } catch (e) {
    // Cyclic or otherwise unserialisable: treat the dialog as edited, which is
    // the safe direction — it keeps the backdrop inert.
    return null;
  }
}

export default {
  data() {
    return {
      /** The form as it looked when the dialog opened. */
      pristineSnapshot: null
    };
  },

  watch: {
    /**
     * Take the baseline when the dialog opens.
     *
     * el-dialog's `open` event is emitted only from its own `visible` watcher,
     * never from mounted(). Eight dialogs here carry a `:key` that is reset as
     * they open, which destroys and recreates el-dialog with visible already
     * true - so those take the mount path and never emit `open` at all. Every
     * one of them exposes the flag as `visible`, and a watcher on it fires in
     * both cases. Dialogs that name the flag something else are not keyed, and
     * are covered by `@open` in the template.
     */
    visible(val) {
      if (val) this.markPristine();
    }
  },

  computed: {
    /** Has anything in the dialog changed since it opened? */
    isDialogDirty() {
      // Before the baseline exists there is nothing to compare against, so the
      // backdrop stays inert. Every unknown here resolves that way: guessing
      // "pristine" wrongly throws away the user's work, guessing "edited"
      // wrongly just means they use Cancel.
      if (this.pristineSnapshot === null) return true;

      const state = this.dirtyState();
      if (state === undefined) {
        // A dialog mixed this in without saying what its content is. Silently
        // treating that as pristine would make the backdrop discard work.
        if (process.env.NODE_ENV !== 'production') {
          // eslint-disable-next-line no-console
          console.warn(
            `[dialogDismiss] ${this.$options.name || 'dialog'} has no dirtyState(): ` +
            'it has no `form`, so override dirtyState() to name the state that ' +
            'would be lost. Backdrop dismissal is off until it does.'
          );
        }
        return true;
      }

      return snapshot(state) !== this.pristineSnapshot;
    },

    /** Bind to el-dialog's `close-on-click-modal`. */
    dismissOnBackdrop() {
      return !this.isDialogDirty;
    }
  },

  methods: {
    /**
     * What counts as this dialog's content. Override when the dialog keeps
     * state outside `form`, such as a list of items or a mode toggle.
     */
    dirtyState() {
      return this.form;
    },

    /**
     * Record the current state as the baseline. Call it when the dialog opens,
     * after the form has been populated — on $nextTick if a watcher fills it
     * in, so the population itself does not read as an edit.
     */
    markPristine() {
      this.$nextTick(() => {
        this.pristineSnapshot = snapshot(this.dirtyState());
      });
    }
  }
};
