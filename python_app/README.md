# DeviceBridge Python Preview

This is the Python-first implementation of DeviceBridge. It uses:

- Python standard-library HTTP server
- SQLite database (`devicebridge.sqlite3`)
- HTML/CSS/JavaScript from the existing DeviceBridge build

The original React/Node project remains untouched in the parent folders as a backup and reference.

## Run

From the `DeviceBridge` folder:

```powershell
python .\python_app\server.py
```

Open http://127.0.0.1:8000 in a browser.

## Demo account

- Email: `demo@devicebridge.local`
- Password: `devicebridge`

The database is created automatically on first run. Delete `python_app/devicebridge.sqlite3` to reset demo data.

## Health check

Open http://127.0.0.1:8000/api/health. A healthy server returns JSON showing the Python backend and SQLite database.
