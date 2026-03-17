"""
Tkinter UI for Yes/No Quiz MiniApp.
Displays yes/no questions, fun facts, results, hints and game state.
"""

import tkinter as tk
import threading
import queue
import logging

logger = logging.getLogger("YesNoQuizUI")

BG = "#0d1b2a"
CARD_BG = "#1b2838"
YES_GREEN = "#00b894"
NO_RED = "#d63031"
CORRECT_GREEN = "#00cec9"
WRONG_RED = "#e17055"
STAR_GOLD = "#fdcb6e"
TEXT_WHITE = "#f5f5f5"
TEXT_MUTED = "#a0a0b0"
HINT_BG = "#2d3436"


class YesNoQuizUI:
    """Tkinter window for the yes/no quiz game."""

    def __init__(self, on_answer_callback=None, on_close_callback=None):
        self.on_answer = on_answer_callback
        self.on_close = on_close_callback
        self._ui_queue = queue.Queue()
        self._running = False
        self._root = None
        self._current_question_id = None

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
        self._root.title("Yes/No Quiz")
        self._root.geometry("480x500")
        self._root.configure(bg=BG)
        self._root.resizable(False, False)
        self._root.protocol("WM_DELETE_WINDOW", self._on_window_close)
        self._root.bind("y", lambda e: self._on_answer("yes"))
        self._root.bind("n", lambda e: self._on_answer("no"))
        self._build_layout()
        self._poll_queue()
        self._root.mainloop()

    def _build_layout(self):
        root = self._root

        top = tk.Frame(root, bg=CARD_BG, pady=8)
        top.pack(fill="x")
        self._stars_label = tk.Label(top, text="Stars: 0", font=("Segoe UI", 14, "bold"), fg=STAR_GOLD, bg=CARD_BG)
        self._stars_label.pack(side="left", padx=20)
        self._q_num_label = tk.Label(top, text="", font=("Segoe UI", 14), fg=TEXT_MUTED, bg=CARD_BG)
        self._q_num_label.pack(side="right", padx=20)

        q_frame = tk.Frame(root, bg=BG, pady=30)
        q_frame.pack(fill="x")
        self._question_label = tk.Label(q_frame, text="Waiting for question...", font=("Segoe UI", 20, "bold"), fg=TEXT_WHITE, bg=BG, wraplength=440, justify="center")
        self._question_label.pack(padx=20)

        btn_frame = tk.Frame(root, bg=BG)
        btn_frame.pack(fill="x", padx=40, pady=20)
        self._yes_btn = tk.Button(btn_frame, text="YES", font=("Segoe UI", 20, "bold"), fg=TEXT_WHITE, bg=YES_GREEN, activebackground="#00a884", relief="flat", cursor="hand2", padx=30, pady=15, command=lambda: self._on_answer("yes"))
        self._yes_btn.pack(side="left", expand=True, fill="x", padx=5)
        self._no_btn = tk.Button(btn_frame, text="NO", font=("Segoe UI", 20, "bold"), fg=TEXT_WHITE, bg=NO_RED, activebackground="#c0392b", relief="flat", cursor="hand2", padx=30, pady=15, command=lambda: self._on_answer("no"))
        self._no_btn.pack(side="right", expand=True, fill="x", padx=5)

        self._result_label = tk.Label(root, text="", font=("Segoe UI", 16, "bold"), fg=TEXT_WHITE, bg=BG, wraplength=440, justify="center")
        self._result_label.pack(pady=5)

        self._funfact_label = tk.Label(root, text="", font=("Segoe UI", 12, "italic"), fg=STAR_GOLD, bg=BG, wraplength=440, justify="center")
        self._funfact_label.pack(pady=5)

        self._hint_label = tk.Label(root, text="", font=("Segoe UI", 13, "italic"), fg=STAR_GOLD, bg=HINT_BG, wraplength=440, justify="center", padx=10, pady=6)

        bot = tk.Frame(root, bg=CARD_BG, pady=6)
        bot.pack(fill="x", side="bottom")
        self._status_label = tk.Label(bot, text="Press Y for Yes, N for No", font=("Segoe UI", 11), fg=TEXT_MUTED, bg=CARD_BG)
        self._status_label.pack()

    def _do_show_question(self, data):
        self._current_question_id = data.get("question_id", "")
        question = data.get("question_text") or data.get("question", "?")
        progress = data.get("progress", {})
        stars = progress.get("stars", 0)
        total = progress.get("total_needed", 5)

        self._stars_label.config(text=f"{'*' * stars} {stars}/{total}")
        self._question_label.config(text=question)
        self._result_label.config(text="")
        self._funfact_label.config(text="")
        self._hint_label.pack_forget()
        self._yes_btn.config(state="normal", bg=YES_GREEN)
        self._no_btn.config(state="normal", bg=NO_RED)

    def _do_show_result(self, data):
        correct = data.get("correct", False)
        fun_fact = data.get("fun_fact", "")
        correct_answer = data.get("correct_answer")

        if correct:
            self._result_label.config(text="Correct!", fg=CORRECT_GREEN)
        else:
            answer_text = "Yes" if correct_answer else "No"
            self._result_label.config(text=f"The answer was {answer_text}", fg=WRONG_RED)

        if fun_fact:
            self._funfact_label.config(text=f"Fun fact: {fun_fact}")

        self._yes_btn.config(state="disabled", bg="#333")
        self._no_btn.config(state="disabled", bg="#333")

        progress = data.get("progress", {})
        stars = progress.get("stars", 0)
        total = progress.get("total_needed", 5)
        self._stars_label.config(text=f"{'*' * stars} {stars}/{total}")

    def _do_show_hint(self, data):
        hint = data.get("hint_text", "Think carefully...")
        self._hint_label.config(text=f"Hint: {hint}")
        self._hint_label.pack(pady=5)

    def _do_show_game_state(self, data):
        state = data.get("state", "")
        progress = data.get("progress", {})
        if state == "game_over":
            stars = progress.get("stars", 0)
            self._question_label.config(text="Game Over!")
            self._result_label.config(text=f"Final score: {'*' * stars} {stars} stars", fg=STAR_GOLD)
            self._yes_btn.config(state="disabled", bg="#333")
            self._no_btn.config(state="disabled", bg="#333")
            self._status_label.config(text="Game finished")
        elif state == "completed":
            self._question_label.config(text="Level Complete!")
            self._result_label.config(text="Get ready for harder questions!", fg=CORRECT_GREEN)

    def _on_answer(self, answer):
        if self._current_question_id and self.on_answer:
            self.on_answer(self._current_question_id, answer)
            self._current_question_id = None

    def _on_window_close(self):
        self._running = False
        if self.on_close:
            self.on_close()
        self._do_destroy()

    def _do_destroy(self):
        if self._root:
            self._root.destroy()
            self._root = None
