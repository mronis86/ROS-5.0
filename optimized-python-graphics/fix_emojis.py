#!/usr/bin/env python3
"""
Script to replace emoji characters with ASCII equivalents
"""

import re

def fix_emojis_in_file(filename):
    """Replace emoji characters with ASCII equivalents"""
    
    # Define emoji replacements
    emoji_replacements = {
        '🔄': '[REFRESH]',
        '✅': '[SUCCESS]',
        '❌': '[ERROR]',
        '⚠️': '[WARNING]',
        '📡': '[SIGNAL]',
        '🔌': '[CONNECT]',
        '📊': '[DATA]',
        '📋': '[LIST]',
        '⏱️': '[TIMER]',
        '🚀': '[ROCKET]'
    }
    
    # Read the file
    with open(filename, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Replace emojis
    for emoji, replacement in emoji_replacements.items():
        content = content.replace(emoji, replacement)
    
    # Write back to file
    with open(filename, 'w', encoding='utf-8') as f:
        f.write(content)
    
    print(f"Fixed emojis in {filename}")

if __name__ == "__main__":
    fix_emojis_in_file("optimized_live_graphics_generator.py")
    print("Emoji replacement completed!")
