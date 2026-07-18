import os
import json
import sys

def configure_mcp():
    print("========================================")
    print("  LeakSnipe - Configure Claude Desktop  ")
    print("========================================")
    
    install_dir = r"C:\Projects\LeakSnipe"
    mcp_script = os.path.join(install_dir, "mcp_server.py")
    python_exe = os.path.join(install_dir, ".venv", "Scripts", "python.exe")
    
    if not os.path.exists(mcp_script):
        # Fallback to checking current script directory
        current_dir = os.path.dirname(os.path.abspath(__file__))
        if os.path.exists(os.path.join(current_dir, "mcp_server.py")):
            install_dir = current_dir
            mcp_script = os.path.join(install_dir, "mcp_server.py")
            python_exe = os.path.join(install_dir, ".venv", "Scripts", "python.exe")
            
    if not os.path.exists(mcp_script):
        print(f"[ERROR] MCP script not found at {mcp_script}")
        print("Please run Setup-LeakSnipe first to clone the repo.")
        sys.exit(1)
        
    # Check if python inside .venv exists, fallback to system python
    command = python_exe if os.path.exists(python_exe) else "python"
    
    # Candidate paths for Claude Desktop config
    user_profile = os.environ.get("USERPROFILE", "C:\\Users\\" + os.environ.get("USERNAME", ""))
    candidates = [
        # Store / UWP version
        os.path.join(user_profile, "AppData", "Local", "Packages", "Claude_pzs8sxrjxfjjc", "LocalCache", "Roaming", "Claude", "claude_desktop_config.json"),
        # Traditional Installer version
        os.path.join(user_profile, "AppData", "Roaming", "Claude", "claude_desktop_config.json")
    ]
    
    found_paths = []
    for p in candidates:
        parent = os.path.dirname(p)
        if os.path.isdir(parent):
            found_paths.append(p)
            
    if not found_paths:
        print("[WARNING] Claude AppData folders not found. Has Claude Desktop been installed and run once?")
        print("Creating default configuration directory under Roaming AppData...")
        roaming_dir = os.path.join(user_profile, "AppData", "Roaming", "Claude")
        os.makedirs(roaming_dir, exist_ok=True)
        found_paths.append(os.path.join(roaming_dir, "claude_desktop_config.json"))
        
    for config_path in found_paths:
        data = {}
        if os.path.exists(config_path):
            try:
                with open(config_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
            except Exception as e:
                print(f"[WARN] Error reading {config_path}: {e}. Creating new config.")
                
        if "mcpServers" not in data:
            data["mcpServers"] = {}
            
        data["mcpServers"]["leaksnipe"] = {
            "command": command,
            "args": [mcp_script]
        }
        
        try:
            with open(config_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
            print(f"[SUCCESS] Configured Claude Desktop MCP at:")
            print(f"  {config_path}")
        except Exception as e:
            print(f"[ERROR] Failed to write {config_path}: {e}")
            
    print("\nConfiguration complete! Please restart Claude Desktop for the changes to take effect.")

if __name__ == "__main__":
    configure_mcp()
