import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import yaml

from tickets.cli import main
from tickets import util


def run_cli(tmpdir: Path, argv):
    cwd = os.getcwd()
    os.chdir(tmpdir)
    try:
        return main(argv)
    finally:
        os.chdir(cwd)


def test_init_creates_structure(tmp_path: Path):
    rc = run_cli(tmp_path, ["init"])
    assert rc == 0
    assert (tmp_path / "TICKETS.md").exists()
    assert (tmp_path / "AGENTS_EXAMPLE.md").exists()
    assert (tmp_path / ".tickets").exists()


def test_new_produces_valid_ticket(tmp_path: Path):
    run_cli(tmp_path, ["init"])
    rc = run_cli(tmp_path, ["new", "--title", "Test Ticket"])
    assert rc == 0
    tickets = list((tmp_path / ".tickets").iterdir())
    assert tickets
    tpath = tickets[0] / "ticket.md"
    issues_rc = run_cli(tmp_path, ["validate"])
    assert issues_rc == 0
    fm, body = util.load_ticket(tpath)
    assert fm["title"] == "Test Ticket"
    assert fm["status"] == "todo"
    assert "## Acceptance Criteria" in body


def test_log_appends_jsonl(tmp_path: Path):
    run_cli(tmp_path, ["init"])
    run_cli(tmp_path, ["new", "--title", "Test Ticket"])
    tid = next((tmp_path / ".tickets").iterdir()).name
    rc = run_cli(
        tmp_path,
        [
            "log",
            "--ticket",
            tid,
            "--actor-type",
            "agent",
            "--actor-id",
            "tester",
            "--summary",
            "did stuff",
            "--machine",
        ],
    )
    assert rc == 0
    logs = list((tmp_path / ".tickets" / tid / "logs").glob("*.jsonl"))
    assert logs
    entries = util.read_jsonl(logs[0])
    assert entries[0]["summary"] == "did stuff"
    assert entries[0]["written_by"] == "tickets"
