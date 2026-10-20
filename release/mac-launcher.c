#include <mach-o/dyld.h>
#include <spawn.h>
#include <unistd.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <limits.h>
#include <time.h>
extern char **environ;

int main(void) {
  struct timespec requested;
  clock_gettime(CLOCK_REALTIME, &requested);
  char launched_at[32];
  snprintf(launched_at, sizeof(launched_at), "%lld", (long long)requested.tv_sec * 1000 + requested.tv_nsec / 1000000);
  setenv("DELIVERY_STUDIO_LAUNCHED_AT", launched_at, 1);
  char executable[PATH_MAX], canonical[PATH_MAX];
  uint32_t size = sizeof(executable);
  if (_NSGetExecutablePath(executable, &size) != 0 || !realpath(executable, canonical)) return 1;
  char *slash = strrchr(canonical, '/');
  if (!slash) return 1;
  *slash = '\0';
  char node[PATH_MAX], script[PATH_MAX];
  if (snprintf(node, sizeof(node), "%s/../Resources/runtime/bin/node", canonical) >= sizeof(node)) return 1;
  if (snprintf(script, sizeof(script), "%s/../Resources/launcher.mjs", canonical) >= sizeof(script)) return 1;
  char *arguments[] = {node, script, NULL};
  posix_spawn_file_actions_t actions;
  posix_spawn_file_actions_init(&actions);
  posix_spawn_file_actions_addopen(&actions, 0, "/dev/null", O_RDONLY, 0);
  posix_spawn_file_actions_addopen(&actions, 1, "/dev/null", O_WRONLY, 0);
  posix_spawn_file_actions_addopen(&actions, 2, "/dev/null", O_WRONLY, 0);
  pid_t child;
  int status = posix_spawn(&child, node, &actions, NULL, arguments, environ);
  posix_spawn_file_actions_destroy(&actions);
  if (status) {
    char *alert[] = {"/usr/bin/osascript", "-e", "display alert \"Delivery Studio could not start\" message \"Extract the entire download and use the version for your Mac processor. Your saved workspace remains on this computer.\"", NULL};
    posix_spawn(&child, alert[0], NULL, NULL, alert, environ);
  }
  return status ? 1 : 0;
}
