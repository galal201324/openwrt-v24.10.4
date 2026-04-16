#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "${script_dir}/.." && pwd)"
git_dir="$(git -C "${repo_root}" rev-parse --git-dir 2>/dev/null)" || exit 0
lock_dir="${git_dir}/autosync.lock"
log_file="${git_dir}/autosync.log"
autocommit="${AUTOSYNC_AUTOCOMMIT:-1}"

log() {
    printf '%s %s\n' "$(date '+%F %T')" "$*" >> "${log_file}"
}

cleanup() {
    rmdir "${lock_dir}" 2>/dev/null || true
}

if ! mkdir "${lock_dir}" 2>/dev/null; then
    exit 0
fi
trap cleanup EXIT

branch="$(git -C "${repo_root}" symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
if [[ -z "${branch}" ]]; then
    log "skip: detached HEAD"
    exit 0
fi

upstream="$(git -C "${repo_root}" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)"
if [[ -z "${upstream}" ]]; then
    log "skip: no upstream for ${branch}"
    exit 0
fi

remote_name="${upstream%%/*}"
can_push=0

if ! git -C "${repo_root}" fetch --quiet --prune "${remote_name}"; then
    log "fetch failed for ${remote_name}"
    exit 1
fi

working_tree_dirty=0
if ! git -C "${repo_root}" diff --quiet || ! git -C "${repo_root}" diff --cached --quiet; then
    working_tree_dirty=1
fi

if [[ -n "$(git -C "${repo_root}" ls-files --others --exclude-standard)" ]]; then
    working_tree_dirty=1
fi

if [[ "${autocommit}" == "1" && "${working_tree_dirty}" == "1" ]]; then
    git -C "${repo_root}" add -A
    if ! git -C "${repo_root}" diff --cached --quiet; then
        timestamp="$(date '+%F %T')"
        if git -C "${repo_root}" commit -m "chore: auto-sync ${timestamp}" >/dev/null 2>&1; then
            log "auto-commit created on ${branch}"
            working_tree_dirty=0
        else
            log "auto-commit failed on ${branch}"
            exit 1
        fi
    fi
fi

if ! git -C "${repo_root}" pull --rebase --autostash --quiet; then
    log "pull --rebase failed on ${branch}"
    exit 1
fi

if GIT_TERMINAL_PROMPT=0 git -C "${repo_root}" push --dry-run --porcelain >/dev/null 2>&1; then
    can_push=1
fi

ahead_count="$(git -C "${repo_root}" rev-list --count '@{u}..HEAD')"
if [[ "${ahead_count}" != "0" ]]; then
    if [[ "${can_push}" != "1" ]]; then
        log "push unavailable on ${branch}; ${ahead_count} commit(s) waiting"
        exit 0
    fi

    if git -C "${repo_root}" push --quiet; then
        log "pushed ${ahead_count} commit(s) from ${branch}"
    else
        log "push failed on ${branch}"
        exit 0
    fi
fi

log "sync ok on ${branch}"