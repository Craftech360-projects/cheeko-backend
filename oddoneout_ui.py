"""
Tkinter UI for Odd One Out MiniApp.
Displays 3-4 option items and asks which doesn't belong.
"""

import tkinter as tk
import threading
import queue
import logging

logger = logging.getLogger("OddOneOutUI")

BG = "#1a1625"
CARD_BG = "#241f31"
ACCENT = "#FFB74D"
CORRECT_GREEN = "#66BB6A"
WRONG_RED = "#EF5350"
STAR_GOLD = "#FFD54F"
TEXT_WHITE = "#E8E0F0"
TEXT_MUTED = "#8A7FA8"
OPTION_BG = "#2E2840"
OPTION_HOVER = "#3D3555"
HINT_BG = "#2d3436"


class OddOneOutUI:
    """Tkinter window for the odd one out game."""

    def __init__(self, on_answer_callback=None, on_close_callback=None):
        self.on_answer = on_answer_callback
        self.on_close = on_close_callback
        self._ui_queue = queue.Queue()
        self._running = False
        self._root = None
        self._current_question_id = None
        self._option_buttons = []

    def start(self):
        if self._running:
            return
        self._running = True
        t = threading.Thread(target=self._run, daemon=True)
        t.start()

    def stop(self):
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

    def _schedule(self, fn, *args):
        self._ui_queue.put((fn, args))

    def _poll_queue(self):
        try:
            while True:
                fn, args = self._ui_queue.get_nowait()
                fn(*args)
        except queue.Empty:
            pass
        if self._running and self._root:
            self._root.after(50, self._poll_queue)

    def _run(self):
        self._root = tk.Tk()
        self._root.title("Odd One Out")
        self._root.geometry("520x580")
        self._root.configure(bg=BG)
        self._root.resizable(False, False)
        self._root.protocol("WM_DELETE_WINDOW", self._on_window_close)
        for i in range(1, 5):
            self._root.bind(str(i), self._on_key_press)
        self._build_layout()
        self._poll_queue()
        self._root.mainloop()

    def _build_layout(self):
        root = self._root

        top = tk.Frame(root, bg=CARD_BG, pady=8)
        top.pack(fill="x")
        self._stars_label = tk.Label(top, text="Stars: 0", font=("Segoe UI", 14, "bold"), fg=STAR_GOLD, bg=CARD_BG)
        self._stars_label.pack(side="left", padx=20)
        self._level_label = tk.Label(top, text="", font=("Segoe UI", 12), fg=TEXT_MUTED, bg=CARD_BG)
        self._level_label.pack(side="left", padx=10)
        self._q_num_label = tk.Label(top, text="", font=("Segoe UI", 14), fg=TEXT_MUTED, bg=CARD_BG)
        self._q_num_label.pack(side="right", padx=20)

        q_frame = tk.Frame(root, bg=BG, pady=20)
        q_frame.pack(fill="x")
        self._question_label = tk.Label(q_frame, text="Which one doesn't belong?", font=("Segoe UI", 18, "bold"), fg=TEXT_WHITE, bg=BG, wraplength=480, justify="center")
        self._question_label.pack(padx=20)

        # Options as a grid (2x2 for 4 options, or 1x3 for 3)
        self._options_frame = tk.Frame(root, bg=BG)
        self._options_frame.pack(fill="both", expand=True, padx=20, pady=10)

        self._result_label = tk.Label(root, text="", font=("Segoe UI", 14, "bold"), fg=TEXT_WHITE, bg=BG, wraplength=480, justify="center")
        self._result_label.pack(pady=3)

        self._explanation_label = tk.Label(root, text="", font=("Segoe UI", 11, "italic"), fg=STAR_GOLD, bg=BG, wraplength=480, justify="center")
        self._explanation_label.pack(pady=3)

        self._hint_label = tk.Label(root, text="", font=("Segoe UI", 12, "italic"), fg=ACCENT, bg=HINT_BG, wraplength=480, justify="center", padx=10, pady=6)

        bot = tk.Frame(root, bg=CARD_BG, pady=6)
        bot.pack(fill="x", side="bottom")
        self._status_label = tk.Label(bot, text="Press 1-4 or click to pick the odd one out", font=("Segoe UI", 11), fg=TEXT_MUTED, bg=CARD_BG)
        self._status_label.pack()

    def _do_show_question(self, data):
        self._current_question_id = data.get("question_id", "")
        question_text = data.get("question_text", "Which one doesn't belong?")
        options = data.get("options", [])
        progress = data.get("progress", {})

        stars = progress.get("stars", 0)
        total = progress.get("total_needed", 5)
        level = progress.get("level", 1)

        self._stars_label.config(text=f"{'*' * stars} {stars}/{total}")
        self._level_label.config(text=f"Level {level}")
        self._question_label.config(text=question_text)
        self._result_label.config(text="")
        self._explanation_label.config(text="")
        self._hint_label.pack_forget()

        for btn in self._option_buttons:
            btn.destroy()
        self._option_buttons.clear()

        # Grid layout: 2 columns
        cols = 2 if len(options) >= 4 else len(options)
        for i, opt in enumerate(options):
            label = opt.get("label", "?")
            value = opt.get("value", label)
            btn = tk.Button(
                self._options_frame,
                text=label,
                font=("Segoe UI", 16, "bold"), fg=TEXT_WHITE, bg=OPTION_BG,
                activebackground=OPTION_HOVER, activeforeground=TEXT_WHITE,
                relief="flat", cursor="hand2",
                padx=20, pady=18,
                command=lambda v=value: self._on_answer_click(v))
            row, col = divmod(i, cols)
            btn.grid(row=row, column=col, padx=6, pady=6, sticky="nsew")
            btn.bind("<Enter>", lambda e, b=btn: b.config(bg=OPTION_HOVER))
            btn.bind("<Leave>", lambda e, b=btn: b.config(bg=OPTION_BG))
            self._option_buttons.append(btn)

        # Make grid columns equal width
        for c in range(cols):
            self._options_frame.columnconfigure(c, weight=1)

        self._status_label.config(text=f"Press 1-{len(options)} or click to pick the odd one out")

    def _do_show_result(self, data):
        correct = data.get("correct", False)
        correct_answer = data.get("correct_answer", "")
        explanation = data.get("explanation", "")
        fun_fact = data.get("fun_fact", "")

        if correct:
            self._result_label.config(text="Correct!", fg=CORRECT_GREEN)
        else:
            self._result_label.config(text=f"The odd one out was {correct_answer}", fg=WRONG_RED)

        explain_text = explanation
        if fun_fact:
            explain_text += f"\n{fun_fact}"
        self._explanation_label.config(text=explain_text)

        for btn in self._option_buttons:
            btn.config(state="disabled", bg="#333")

        progress = data.get("progress", {})
        stars = progress.get("stars", 0)
        total = progress.get("total_needed", 5)
        self._stars_label.config(text=f"{'*' * stars} {stars}/{total}")

    def _do_show_hint(self, data):
        hint = data.get("hint_text", "Think about what the others have in common...")
        self._hint_label.config(text=f"Hint: {hint}")
        self._hint_label.pack(pady=5)

        # Grey out eliminated option if provided
        eliminated_id = data.get("eliminated_id")
        if eliminated_id:
            for btn in self._option_buttons:
                if btn.cget("text") == eliminated_id:
                    btn.config(state="disabled", bg="#333", fg="#666")

    def _do_show_game_state(self, data):
        state = data.get("state", "")
        progress = data.get("progress", {})
        if state == "game_over":
            stars = progress.get("stars", 0)
            self._question_label.config(text="Game Over!")
            self._result_label.config(text=f"Final score: {'*' * stars} {stars} stars", fg=STAR_GOLD)
            for btn in self._option_buttons:
                btn.destroy()
            self._option_buttons.clear()
            self._status_label.config(text="Game finished")
        elif state == "completed":
            self._question_label.config(text="Level Complete!")
            self._result_label.config(text="Get ready for harder questions!", fg=CORRECT_GREEN)

    def _on_answer_click(self, value):
        if self._current_question_id and self.on_answer:
            self.on_answer(self._current_question_id, value)
            self._current_question_id = None

    def _on_key_press(self, event):
        idx = int(event.char) - 1
        if 0 <= idx < len(self._option_buttons) and self._current_question_id:
            self._option_buttons[idx].invoke()

    def _on_window_close(self):
        self._running = False
        if self.on_close:
            self.on_close()
        self._do_destroy()

    def _do_destroy(self):
        if self._root:
            self._root.destroy()
            self._root = None
