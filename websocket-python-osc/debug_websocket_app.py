import tkinter as tk
from tkinter import ttk, scrolledtext
from datetime import datetime

class DebugWebSocketApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Debug WebSocket OSC App")
        self.root.geometry("1200x900")
        
        print("Creating notebook...")
        self.setup_ui()
        print("UI setup complete")
    
    def setup_ui(self):
        # Create notebook for tabs
        notebook = ttk.Notebook(self.root)
        notebook.pack(fill='both', expand=True, padx=10, pady=10)
        print("Notebook created and packed")
        
        # Events Tab
        events_frame = ttk.Frame(notebook)
        notebook.add(events_frame, text="Events")
        self.setup_events_tab(events_frame)
        print("Events tab added")
        
        # OSC Tab
        osc_frame = ttk.Frame(notebook)
        notebook.add(osc_frame, text="OSC Server")
        self.setup_osc_tab(osc_frame)
        print("OSC tab added")
        
        # Log Tab
        log_frame = ttk.Frame(notebook)
        notebook.add(log_frame, text="Log")
        self.setup_log_tab(log_frame)
        print("Log tab added")
        
        # Add initial log message
        self.log_message("Debug app started - Log tab should be visible")
    
    def setup_events_tab(self, parent):
        ttk.Label(parent, text="Events tab content").pack(pady=20)
    
    def setup_osc_tab(self, parent):
        ttk.Label(parent, text="OSC Server tab content").pack(pady=20)
    
    def setup_log_tab(self, parent):
        print("Setting up log tab...")
        self.log_text = scrolledtext.ScrolledText(parent, height=25)
        self.log_text.pack(fill='both', expand=True, padx=5, pady=5)
        print("Log text widget created")
        
        button_frame = ttk.Frame(parent)
        button_frame.pack(pady=5)
        ttk.Button(button_frame, text="Clear Log", command=self.clear_log).pack(side='left', padx=5)
        ttk.Button(button_frame, text="Test Message", command=self.add_test_message).pack(side='left', padx=5)
        print("Log tab setup complete")
    
    def log_message(self, message):
        timestamp = datetime.now().strftime("%H:%M:%S")
        log_entry = f"[{timestamp}] {message}\n"
        
        self.log_text.insert(tk.END, log_entry)
        self.log_text.see(tk.END)
        print(f"Log message added: {message}")
    
    def clear_log(self):
        self.log_text.delete(1.0, tk.END)
        self.log_message("Log cleared")
    
    def add_test_message(self):
        self.log_message("Test message from button")

def main():
    root = tk.Tk()
    app = DebugWebSocketApp(root)
    print("Starting mainloop...")
    root.mainloop()

if __name__ == "__main__":
    main()
