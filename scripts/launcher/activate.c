// launchd keeps Transporter's port open while nothing runs. On the first
// connection it starts this program, which takes the listening sockets from
// launchd and hands them to Node (as LISTEN_FDS) before exec'ing it.
//
// Usage: transporter-activate <node> <script> [args...]

#include <fcntl.h>
#include <launch.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

int main(int argc, char **argv) {
  if (argc < 2) {
    fprintf(stderr, "usage: %s <program> [args...]\n", argv[0]);
    return 64;
  }

  int *fds = NULL;
  size_t count = 0;
  int err = launch_activate_socket("Listener", &fds, &count);
  if (err != 0 || count == 0) {
    fprintf(stderr, "launch_activate_socket: %s\n", strerror(err));
    return 1;
  }

  char list[256] = "";
  for (size_t i = 0; i < count; i++) {
    // Keep the sockets open across exec so Node inherits them.
    fcntl(fds[i], F_SETFD, fcntl(fds[i], F_GETFD) & ~FD_CLOEXEC);
    char item[16];
    snprintf(item, sizeof item, i ? ",%d" : "%d", fds[i]);
    strncat(list, item, sizeof list - strlen(list) - 1);
  }
  free(fds);

  setenv("LISTEN_FDS", list, 1);
  execv(argv[1], argv + 1);
  perror("execv");
  return 1;
}
