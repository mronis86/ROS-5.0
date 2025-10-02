import tkinter as tk
from tkinter import ttk, scrolledtext
from datetime import datetime

class TestLogTab:
    def __init__(self, root):
        self.root = root
        self.root.title("Test Log Tab")
        self.root.geometry("800x600")
        
        # Create notebook for tabs
        notebook = ttk.Notebook(self.root)
        notebook.pack(fill='both', expand=True, padx=10, pady=10)
        
        # Test Tab
        test_frame = ttk.Frame(notebook)
        notebook.add(test_frame, text="Test")
        
        ttk.Label(test_frame, text="This is a test tab").pack(pady=20)
        ttk.Button(test_frame, text="Add Log Message", command=self.add_test_message).pack(pady=10)
        
        # Log Tab
        log_frame = ttk.Frame(notebook)
        notebook.add(log_frame, text="Log")
        self.setup_log_tab(log_frame)
    
    def setup_log_tab(self, parent):
        self.log_text = scrolledtext.ScrolledText(parent, height=25)
        self.log_text.pack(fill='both', expand=True, padx=5, pady=5)
        
        button_frame = ttk.Frame(parent)
        button_frame.pack(pady=5)
        ttk.Button(button_frame, text="Clear Log", command=self.clear_log).pack(side='left', padx=5)
        ttk.Button(button_frame, text="Add Test Message", command=self.add_test_message).pack(side='left', padx=5)
    
    def log_message(self, message):
        timestamp = datetime.now().strftime("%H:%M:%S")
        log_entry = f"[{timestamp}] {message}\n"
        
        self.log_text.insert(tk.END, log_entry)
        self.log_text.see(tk.END)
    
    def clear_log(self):
        self.log_text.delete(1.0, tk.END)
    
    def add_test_message(self):
        self.log_message("Test message added")

if __name__ == "__main__":
    root = tk.Tk()
    app = TestLogTab(root)
    root.mainloop()
