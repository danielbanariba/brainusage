import Gio from 'gi://Gio';

// Runs a shell command through /bin/sh and resolves its outcome, the same
// Gio-wrapped-in-a-Promise shape used by runtime/fs.js and runtime/fetch.js.
// The caller (shared/core/keepalive.js's buildShellCommand()) already wraps
// the user command with `timeout`, so no timeout logic is needed here.
// Only stderr is piped -- stdout is irrelevant to the keepalive ping and is
// left inherited/discarded.
export function runShell(shellCommand) {
    return new Promise((resolve, reject) => {
        let proc;

        try {
            proc = Gio.Subprocess.new(
                ['/bin/sh', '-c', shellCommand],
                Gio.SubprocessFlags.STDERR_PIPE,
            );
        } catch (error) {
            reject(error);
            return;
        }

        proc.communicate_utf8_async(null, null, (source, result) => {
            try {
                const [, , stderr] = source.communicate_utf8_finish(result);
                resolve({
                    exitCode: source.get_exit_status(),
                    stderr: stderr ?? '',
                });
            } catch (error) {
                reject(error);
            }
        });
    });
}
