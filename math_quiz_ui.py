"""
Tkinter UI for Math Quiz MiniApp.

Displays questions, options, results, hints and game state
in a child-friendly window. Communicates with TestClient via callbacks.
"""

import tkinter as tk
import threading
import queue
import logging

logger = logging.getLogger("MathQuizUI")

# Colors
BG = "#1a1a2e"
CARD_BG = "#16213e"
ACCENT = "#e94560"
CORRECT_GREEN = "#00b894"
WRONG_RED = "#d63031"
STAR_GOLD = "#fdcb6e"
TEXT_WHITE = "#f5f5f5"
TEXT_MUTED = "#a0a0b0"
OPTION_BG = "#0f3460"
OPTION_HOVER = "#1a4a7a"
HINT_BG = "#2d3436"


class MathQuizUI:
    """Tkinter window for the math quiz game."""

    def __init__(self, on_answer_callback=None, on_close_callback=None):
        """
        Args:
            on_answer_callback: fn(question_id, value) called when user clicks an answer.
            on_close_callback: fn() called when window is closed.
        """
        self.on_answer = on_answer_callback
        self.on_close = on_close_callback
        self._ui_queue = queue.Queue()
        self._running = False
        self._root = None
        self._current_question_id = None
        self._option_buttons = []

    # ── Public API (thread-safe, called from MQTT thread) ──

    def start(self):
        """Launch the UI in a new thread."""
        if self._running:
            return
        self._running = True
        t = threading.Thread(target=self._run, daemon=True)
        t.start()

    def stop(self):
        """Close the window."""
        self._running = False
        self._schedule(self._do_destroy)

    def show_question(self, data: dict):
        self._schedule(self._do_show_question, data)

    def show_result(self, data: dict):
        self._schedule(self._do_show_result, data)

    def show_hint(self, data: dict):
        self._schedule(self._do_show_hint, data)

    def show_game_state(self, data: dict):
        self._schedule(self._do_show_game_state, data)

    # ── Internal: thread-safe scheduling ──

    def _schedule(self, fn, *args):
        self._ui_queue.put((fn, args))

    def _poll_queue(self):
        """Drain the queue on the Tk thread."""
        try:
            while True:
                fn, args = self._ui_queue.get_nowait()
                fn(*args)
        except queue.Empty:
            pass
        if self._running and self._root:
            self._root.after(50, self._poll_queue)

    # ── Tk main loop (runs in its own thread) ──

    def _run(self):
        self._root = tk.Tk()
        self._root.title("Math Quiz")
        self._root.geometry("480x640")
        self._root.configure(bg=BG)
        self._root.resizable(False, False)
        self._root.protocol("WM_DELETE_WINDOW", self._on_window_close)

        # Bind number keys 1-4 for keyboard answers
        for i in range(1, 5):
            self._root.bind(str(i), self._on_key_press)

        self._build_layout()
        self._poll_queue()
        self._root.mainloop()

    def _build_layout(self):
        root = self._root

        # ── Top bar: stars + question number ──
        top = tk.Frame(root, bg=CARD_BG, pady=8)
        top.pack(fill="x")

        self._stars_label = tk.Label(
            top, text="Stars: 0", font=("Segoe UI", 14, "bold"),
            fg=STAR_GOLD, bg=CARD_BG)
        self._stars_label.pack(side="left", padx=20)

        self._level_label = tk.Label(
            top, text="", font=("Segoe UI", 12),
            fg=TEXT_MUTED, bg=CARD_BG)
        self._level_label.pack(side="left", padx=10)

        self._q_num_label = tk.Label(
            top, text="", font=("Segoe UI", 14),
            fg=TEXT_MUTED, bg=CARD_BG)
        self._q_num_label.pack(side="right", padx=20)

        # ── Question area ──
        q_frame = tk.Frame(root, bg=BG, pady=20)
        q_frame.pack(fill="x")

        self._question_label = tk.Label(
            q_frame, text="Waiting for question...",
            font=("Segoe UI", 22, "bold"), fg=TEXT_WHITE, bg=BG,
            wraplength=440, justify="center")
        self._question_label.pack(padx=20)

        # ── Options area ──
        self._options_frame = tk.Frame(root, bg=BG)
        self._options_frame.pack(fill="both", expand=True, padx=30)

        # ── Result / hint overlay ──
        self._result_label = tk.Label(
            root, text="", font=("Segoe UI", 18, "bold"),
            fg=TEXT_WHITE, bg=BG, wraplength=440, justify="center")
        self._result_label.pack(pady=5)

        self._hint_label = tk.Label(
            root, text="", font=("Segoe UI", 13, "italic"),
            fg=STAR_GOLD, bg=HINT_BG, wraplength=440, justify="center",
            padx=10, pady=6)
        # hint_label packed/unpacked dynamically

        # ── Bottom status ──
        bot = tk.Frame(root, bg=CARD_BG, pady=6)
        bot.pack(fill="x", side="bottom")

        self._status_label = tk.Label(
            bot, text="Press 1-4 or click to answer",
            font=("Segoe UI", 11), fg=TEXT_MUTED, bg=CARD_BG)
        self._status_label.pack()

    # ── UI update methods (always called on Tk thread) ──

    def _do_show_question(self, data):
        question_text = data.get("question_text", "?")
        options = data.get("options", [])
        progress = data.get("progress", {})
        self._current_question_id = data.get("question_id", "")

        stars = progress.get("stars", 0)
        total_needed = progress.get("total_needed", 5)
        level = progress.get("level", 1)
        mission = progress.get("mission_number", "")
        q_num = progress.get("questions_answered", 0) + 1

        self._stars_label.config(text=f"{'*' * stars} {stars}/{total_needed}")
        self._level_label.config(text=f"Level {level}  |  Mission {mission}")
        self._q_num_label.config(text=f"Question #{q_num}")
        self._question_label.config(text=question_text)
        self._result_label.config(text="")
        self._hint_label.pack_forget()

        # Clear old option buttons
        for btn in self._option_buttons:
            btn.destroy()
        self._option_buttons.clear()

        # Create option buttons
        for i, opt in enumerate(options):
            label = opt.get("label", "?")
            value = opt.get("value")
            btn = tk.Button(
                self._options_frame,
                text=f"  {i + 1}.  {label}",
                font=("Segoe UI", 16), fg=TEXT_WHITE, bg=OPTION_BG,
                activebackground=OPTION_HOVER, activeforeground=TEXT_WHITE,
                relief="flat", cursor="hand2", anchor="w",
                padx=20, pady=12,
                command=lambda v=value: self._on_answer_click(v))
            btn.pack(fill="x", pady=5)
            # Hover effects
            btn.bind("<Enter>", lambda e, b=btn: b.config(bg=OPTION_HOVER))
            btn.bind("<Leave>", lambda e, b=btn: b.config(bg=OPTION_BG))
            self._option_buttons.append(btn)

        self._status_label.config(text=f"Press 1-{len(options)} or click to answer")

    def _do_show_result(self, data):
        correct = data.get("correct", False)
        answer = data.get("correct_answer")
        retry = data.get("retry", False)
        progress = data.get("progress", {})
        stars = progress.get("stars", 0)

        if correct:
            self._result_label.config(text="Correct!", fg=CORRECT_GREEN)
        elif answer is not None:
            self._result_label.config(text=f"Wrong — answer was {answer}", fg=WRONG_RED)
        else:
            self._result_label.config(text="Not quite — try again!", fg=WRONG_RED)

        self._stars_label.config(text=f"{'*' * stars} {stars}")

        # Disable buttons temporarily
        for btn in self._option_buttons:
            btn.config(state="disabled", bg="#333")

        # Re-enable buttons after a short delay if retry
        if retry:
            self._current_question_id = data.get("question_id", self._current_question_id)
            if self._root:
                self._root.after(1500, self._reenable_buttons)

        if data.get("game_over"):
            self._do_game_over(stars)

    def _reenable_buttons(self):
        """Re-enable option buttons after a retry delay."""
        for btn in self._option_buttons:
            btn.config(state="normal", bg=OPTION_BG)
        self._result_label.config(text="")
        self._hint_label.pack_forget()

    def _do_show_hint(self, data):
        hint_type = data.get("hint_type", "")
        remaining = data.get("remaining_options", [])
        eliminated = data.get("eliminated_value")

        if hint_type == "eliminate" and remaining:
            # Rebuild option buttons with only remaining options
            for btn in self._option_buttons:
                btn.destroy()
            self._option_buttons.clear()

            for i, opt in enumerate(remaining):
                label = opt.get("label", "?")
                value = opt.get("value")
                btn = tk.Button(
                    self._options_frame,
                    text=f"  {i + 1}.  {label}",
                    font=("Segoe UI", 16), fg=TEXT_WHITE, bg=OPTION_BG,
                    activebackground=OPTION_HOVER, activeforeground=TEXT_WHITE,
                    relief="flat", cursor="hand2", anchor="w",
                    padx=20, pady=12,
                    command=lambda v=value: self._on_answer_click(v))
                btn.pack(fill="x", pady=5)
                btn.bind("<Enter>", lambda e, b=btn: b.config(bg=OPTION_HOVER))
                btn.bind("<Leave>", lambda e, b=btn: b.config(bg=OPTION_BG))
                self._option_buttons.append(btn)

            self._status_label.config(text=f"Press 1-{len(remaining)} or click to answer")
            self._hint_label.config(text=f"Hint: Removed {eliminated}!")
        else:
            self._hint_label.config(text=f"Hint: Try again!")

        self._hint_label.pack(pady=5)

    def _do_show_game_state(self, data):
        state = data.get("state", "unknown")
        progress = data.get("progress", {})
        if state == "game_over":
            stars = progress.get("stars", 0)
            answered = progress.get("questions_answered", 0)
            self._do_game_over(stars, answered)

    def _do_game_over(self, stars, answered=None):
        self._question_label.config(text="Game Over!")
        for btn in self._option_buttons:
            btn.destroy()
        self._option_buttons.clear()

        msg = f"Final score: {'*' * stars} {stars} stars"
        if answered is not None:
            msg += f"\nQuestions answered: {answered}"
        self._result_label.config(text=msg, fg=STAR_GOLD)
        self._status_label.config(text="Game finished")

    def _do_destroy(self):
        if self._root:
            self._root.destroy()
            self._root = None

    # ── Event handlers ──

    def _on_answer_click(self, value):
        if self._current_question_id and self.on_answer:
            self.on_answer(self._current_question_id, value)
            self._current_question_id = None

    def _on_key_press(self, event):
        idx = int(event.char) - 1
        if 0 <= idx < len(self._option_buttons) and self._current_question_id:
            value_cmd = self._option_buttons[idx].cget("command")
            # Simulate button click
            self._option_buttons[idx].invoke()

    def _on_window_close(self):
        self._running = False
        if self.on_close:
            self.on_close()
        self._do_destroy()
