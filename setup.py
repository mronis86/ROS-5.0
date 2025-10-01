from setuptools import setup, find_packages

setup(
    name="osc-gui-app",
    version="1.0.0",
    description="OSC GUI Application with Supabase Integration",
    author="Your Name",
    author_email="your.email@example.com",
    packages=find_packages(),
    install_requires=[
        "supabase==2.3.4",
    ],
    python_requires=">=3.8",
    entry_points={
        "console_scripts": [
            "osc-gui=fixed_osc_gui_app (8):main",
        ],
    },
    classifiers=[
        "Development Status :: 4 - Beta",
        "Intended Audience :: Developers",
        "License :: OSI Approved :: MIT License",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.8",
        "Programming Language :: Python :: 3.9",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
    ],
)
