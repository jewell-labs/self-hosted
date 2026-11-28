/* Blocking POSIX helpers for the txiki.js tool runtime.
   txiki cannot Atomics.wait on its main thread, and its file APIs are promises.
   Every function returns 0 or a positive byte count, or -errno. */
#define _DARWIN_C_SOURCE
#define _GNU_SOURCE

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <ftw.h>
#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <sys/types.h>
#include <sys/utsname.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#include <arpa/inet.h>
#include <ifaddrs.h>
#include <netinet/in.h>
#include <signal.h>
#include <spawn.h>
#include <sys/socket.h>

#if defined(__APPLE__)
#include <mach/mach.h>
#include <sys/sysctl.h>
#else
#include <sys/statvfs.h>
#include <sys/sysinfo.h>
#endif

#if !defined(__APPLE__)
#include <sys/statvfs.h>
#endif

#if defined(__APPLE__)
#include <sys/mount.h>
#endif

extern char **environ;

static int fail(void) {
  return -errno;
}

const char *sh_errname(int err) {
  switch (err) {
    case EPERM: return "EPERM";
    case ENOENT: return "ENOENT";
    case EIO: return "EIO";
    case EACCES: return "EACCES";
    case EEXIST: return "EEXIST";
    case ENOTDIR: return "ENOTDIR";
    case EISDIR: return "EISDIR";
    case EINVAL: return "EINVAL";
    case EFBIG: return "EFBIG";
    case ENOSPC: return "ENOSPC";
    case EROFS: return "EROFS";
    case EAGAIN: return "EAGAIN";
    case EBUSY: return "EBUSY";
    case ENOTEMPTY: return "ENOTEMPTY";
    case ENAMETOOLONG: return "ENAMETOOLONG";
    case ETIMEDOUT: return "ETIMEDOUT";
    default: return "EIO";
  }
}

int sh_sleep_ms(int ms) {
  if (ms < 0) ms = 0;
  struct timespec ts;
  ts.tv_sec = ms / 1000;
  ts.tv_nsec = (long)(ms % 1000) * 1000000L;
  while (nanosleep(&ts, &ts) != 0) {
    if (errno != EINTR) return fail();
  }
  return 0;
}

int sh_isatty(int fd) {
  return isatty(fd) ? 1 : 0;
}

int sh_write_fd(int fd, const void *data, int len) {
  const char *cursor = data;
  int left = len;
  if (left < 0) return -EINVAL;
  while (left > 0) {
    ssize_t wrote = write(fd, cursor, (size_t)left);
    if (wrote < 0) {
      if (errno == EINTR) continue;
      return fail();
    }
    cursor += wrote;
    left -= (int)wrote;
  }
  return 0;
}

int sh_read_at(const char *path, void *buf, int cap, int offset_hi, int offset_lo) {
  if (cap < 0) return -EINVAL;
  int64_t offset = ((int64_t)offset_hi << 32) | (uint32_t)offset_lo;
  int fd = open(path, O_RDONLY);
  if (fd < 0) return fail();
  ssize_t got = pread(fd, buf, (size_t)cap, offset);
  int err = errno;
  close(fd);
  if (got < 0) return -err;
  return (int)got;
}

int sh_write(const char *path, const void *data, int len, int flags) {
  if (len < 0) return -EINVAL;
  int open_flags = O_WRONLY | O_CREAT;
  if (flags & 1) open_flags |= O_APPEND;
  else open_flags |= O_TRUNC;
  if (flags & 2) open_flags |= O_EXCL;
  int fd = open(path, open_flags, 0666);
  if (fd < 0) return fail();
  if (len > 0) {
    int wrote = sh_write_fd(fd, data, len);
    if (wrote != 0) {
      close(fd);
      return wrote;
    }
  }
  if (close(fd) != 0) return fail();
  return 0;
}

int sh_chmod(const char *path, int mode) {
  if (chmod(path, (mode_t)mode) != 0) return fail();
  return 0;
}

int sh_mkdir(const char *path, int mode) {
  if (mkdir(path, (mode_t)mode) != 0) return fail();
  return 0;
}

int sh_mkdir_p(const char *path) {
  char copy[PATH_MAX];
  size_t len = strlen(path);
  if (len == 0 || len >= sizeof copy) return -ENAMETOOLONG;
  memcpy(copy, path, len + 1);
  for (size_t i = 1; i < len; i += 1) {
    if (copy[i] != '/') continue;
    copy[i] = 0;
    if (copy[0] != 0 && mkdir(copy, 0777) != 0 && errno != EEXIST) return fail();
    copy[i] = '/';
  }
  if (mkdir(copy, 0777) != 0 && errno != EEXIST) return fail();
  struct stat st;
  if (stat(copy, &st) != 0) return fail();
  if (!S_ISDIR(st.st_mode)) return -EEXIST;
  return 0;
}

int sh_unlink(const char *path) {
  if (unlink(path) != 0) return fail();
  return 0;
}

int sh_rename(const char *from, const char *to) {
  if (rename(from, to) != 0) return fail();
  return 0;
}

int sh_symlink(const char *target, const char *link_path) {
  if (symlink(target, link_path) != 0) return fail();
  return 0;
}

int sh_link(const char *from, const char *to) {
  if (link(from, to) != 0) return fail();
  return 0;
}

static int rm_entry(const char *fpath, const struct stat *st, int type, struct FTW *info) {
  (void)st;
  (void)info;
  if (type == FTW_DP || type == FTW_D) {
    if (rmdir(fpath) != 0 && errno != ENOENT) return -1;
    return 0;
  }
  if (unlink(fpath) != 0 && errno != ENOENT) return -1;
  return 0;
}

int sh_rm_rf(const char *path) {
  struct stat st;
  if (lstat(path, &st) != 0) return fail();
  if (S_ISLNK(st.st_mode) || !S_ISDIR(st.st_mode)) {
    if (unlink(path) != 0) return fail();
    return 0;
  }
  if (nftw(path, rm_entry, 16, FTW_DEPTH | FTW_PHYS) != 0) return fail();
  return 0;
}

static int write_stat(const struct stat *st, char *buf, int cap) {
  char kind = 'o';
  if (S_ISREG(st->st_mode)) kind = 'f';
  else if (S_ISDIR(st->st_mode)) kind = 'd';
  else if (S_ISLNK(st->st_mode)) kind = 'l';
#if defined(__APPLE__)
  long long mtime = (long long)st->st_mtimespec.tv_sec * 1000 + st->st_mtimespec.tv_nsec / 1000000;
#else
  long long mtime = (long long)st->st_mtim.tv_sec * 1000 + st->st_mtim.tv_nsec / 1000000;
#endif
  int wrote = snprintf(buf, (size_t)cap, "%c %u %lld %lld", kind, (unsigned)st->st_mode, (long long)st->st_size, mtime);
  if (wrote < 0 || wrote >= cap) return -ENOSPC;
  return 0;
}

int sh_lstat_text(const char *path, char *buf, int cap) {
  struct stat st;
  if (lstat(path, &st) != 0) return fail();
  return write_stat(&st, buf, cap);
}

int sh_stat_text(const char *path, char *buf, int cap) {
  struct stat st;
  if (stat(path, &st) != 0) return fail();
  return write_stat(&st, buf, cap);
}

int sh_realpath(const char *path, char *buf, int cap) {
  char resolved[PATH_MAX];
  if (!realpath(path, resolved)) return fail();
  int wrote = snprintf(buf, (size_t)cap, "%s", resolved);
  if (wrote < 0 || wrote >= cap) return -ENOSPC;
  return 0;
}

int sh_readlink(const char *path, char *buf, int cap) {
  if (cap < 2) return -ENOSPC;
  ssize_t got = readlink(path, buf, (size_t)cap - 1);
  if (got < 0) return fail();
  buf[got] = 0;
  return (int)got;
}

static char dirent_kind(const char *dir, const struct dirent *entry) {
  unsigned char kind = entry->d_type;
  if (kind == DT_REG) return 'f';
  if (kind == DT_DIR) return 'd';
  if (kind == DT_LNK) return 'l';
  if (kind != DT_UNKNOWN) return 'o';
  char path[PATH_MAX];
  if (snprintf(path, sizeof path, "%s/%s", dir, entry->d_name) >= (int)sizeof path) return 'o';
  struct stat st;
  if (lstat(path, &st) != 0) return 'o';
  if (S_ISREG(st.st_mode)) return 'f';
  if (S_ISDIR(st.st_mode)) return 'd';
  if (S_ISLNK(st.st_mode)) return 'l';
  return 'o';
}

static int readdir_need(const char *path, char *buf, int cap, int *need_out) {
  DIR *dir = opendir(path);
  if (!dir) return fail();
  int need = 0;
  struct dirent *entry;
  while ((entry = readdir(dir)) != NULL) {
    if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0) continue;
    int rec = 1 + (int)strlen(entry->d_name) + 1;
    if (buf && need + rec <= cap) {
      buf[need] = dirent_kind(path, entry);
      memcpy(buf + need + 1, entry->d_name, (size_t)rec - 1);
    }
    need += rec;
  }
  closedir(dir);
  *need_out = need;
  return 0;
}

int sh_readdir_size(const char *path) {
  int need = 0;
  int rc = readdir_need(path, NULL, 0, &need);
  if (rc != 0) return rc;
  return need;
}

int sh_readdir(const char *path, char *buf, int cap) {
  int need = 0;
  int rc = readdir_need(path, buf, cap, &need);
  if (rc != 0) return rc;
  if (need > cap) return -ENOSPC;
  return need;
}

int sh_open_excl(const char *path) {
  int fd = open(path, O_CREAT | O_EXCL | O_RDWR, 0600);
  if (fd < 0) return fail();
  return fd;
}

int sh_close(int fd) {
  if (close(fd) != 0) return fail();
  return 0;
}

int sh_mkdtemp(const char *prefix, char *buf, int cap) {
  char tmpl[PATH_MAX];
  if (snprintf(tmpl, sizeof tmpl, "%sXXXXXX", prefix) >= (int)sizeof tmpl) return -ENAMETOOLONG;
  if (!mkdtemp(tmpl)) return fail();
  if (snprintf(buf, (size_t)cap, "%s", tmpl) >= cap) return -ENOSPC;
  return 0;
}

int sh_getcwd(char *buf, int cap) {
  if (!getcwd(buf, (size_t)cap)) return fail();
  return 0;
}

int sh_hostname(char *buf, int cap) {
  if (gethostname(buf, (size_t)cap) != 0) return fail();
  buf[cap - 1] = 0;
  return 0;
}

int sh_ncpu(void) {
  long count = sysconf(_SC_NPROCESSORS_ONLN);
  if (count < 1) return 1;
  return (int)count;
}

int sh_uname(char *buf, int cap) {
  struct utsname name;
  if (uname(&name) != 0) return fail();
  if (snprintf(buf, (size_t)cap, "%s %s", name.sysname, name.machine) >= cap) return -ENOSPC;
  return 0;
}

int sh_mem_text(char *buf, int cap) {
#if defined(__APPLE__)
  int64_t total = 0;
  size_t len = sizeof total;
  if (sysctlbyname("hw.memsize", &total, &len, NULL, 0) != 0) return fail();
  int64_t page = 4096;
  len = sizeof page;
  sysctlbyname("hw.pagesize", &page, &len, NULL, 0);
  vm_statistics64_data_t vm;
  mach_msg_type_number_t count = HOST_VM_INFO64_COUNT;
  if (host_statistics64(mach_host_self(), HOST_VM_INFO64, (host_info64_t)&vm, &count) != KERN_SUCCESS) return -EIO;
  long long free_bytes = (long long)(vm.free_count + vm.inactive_count) * (long long)page;
  if (snprintf(buf, (size_t)cap, "%lld %lld", (long long)total, free_bytes) >= cap) return -ENOSPC;
#else
  struct sysinfo info;
  if (sysinfo(&info) != 0) return fail();
  long long unit = info.mem_unit > 0 ? info.mem_unit : 1;
  long long total = (long long)info.totalram * unit;
  long long free_bytes = (long long)info.freeram * unit;
  if (snprintf(buf, (size_t)cap, "%lld %lld", total, free_bytes) >= cap) return -ENOSPC;
#endif
  return 0;
}

int sh_statfs_text(const char *path, char *buf, int cap) {
#if defined(__APPLE__)
  struct statfs st;
  if (statfs(path, &st) != 0) return fail();
  unsigned long long bsize = (unsigned long long)st.f_bsize;
  unsigned long long blocks = (unsigned long long)st.f_blocks;
  unsigned long long bfree = (unsigned long long)st.f_bfree;
  unsigned long long bavail = (unsigned long long)st.f_bavail;
#else
  struct statvfs st;
  if (statvfs(path, &st) != 0) return fail();
  unsigned long long bsize = (unsigned long long)st.f_frsize;
  unsigned long long blocks = (unsigned long long)st.f_blocks;
  unsigned long long bfree = (unsigned long long)st.f_bfree;
  unsigned long long bavail = (unsigned long long)st.f_bavail;
#endif
  if (snprintf(buf, (size_t)cap, "%llu %llu %llu %llu", bsize, blocks, bfree, bavail) >= cap) return -ENOSPC;
  return 0;
}

int sh_ifaddrs(char *buf, int cap) {
  struct ifaddrs *list = NULL;
  if (getifaddrs(&list) != 0) return fail();
  int used = 0;
  for (struct ifaddrs *item = list; item; item = item->ifa_next) {
    if (!item->ifa_addr || item->ifa_addr->sa_family != AF_INET) continue;
    char address[INET_ADDRSTRLEN];
    const void *raw = &((struct sockaddr_in *)item->ifa_addr)->sin_addr;
    if (!inet_ntop(AF_INET, raw, address, sizeof address)) continue;
    int internal = strcmp(item->ifa_name, "lo") == 0 || strcmp(item->ifa_name, "lo0") == 0;
    int wrote = snprintf(buf + used, (size_t)(cap - used), "%s\t%s\t%d\n", item->ifa_name, address, internal);
    if (wrote < 0 || wrote >= cap - used) {
      freeifaddrs(list);
      return -ENOSPC;
    }
    used += wrote;
  }
  freeifaddrs(list);
  return used;
}

static char **unpack(const char *packed) {
  if (!packed || packed[0] == 0) return NULL;
  int count = 0;
  for (const char *cursor = packed; *cursor; cursor += strlen(cursor) + 1) count += 1;
  char **list = calloc((size_t)count + 1, sizeof(char *));
  if (!list) return NULL;
  const char *cursor = packed;
  for (int i = 0; i < count; i += 1) {
    list[i] = (char *)cursor;
    cursor += strlen(cursor) + 1;
  }
  return list;
}

static void write_status(char *buf, int cap, int code, int signal, int pid, int timed_out) {
  snprintf(buf, (size_t)cap, "%d %d %d %d", code, signal, pid, timed_out);
}

static int add_stdio(posix_spawn_file_actions_t *actions, int mode, const char *out_path, const char *err_path) {
  if (mode == 0) return 0;
  const char *out = mode == 2 ? "/dev/null" : out_path;
  const char *err = mode == 2 ? "/dev/null" : err_path;
  if (posix_spawn_file_actions_addopen(actions, STDIN_FILENO, "/dev/null", O_RDONLY, 0) != 0) return -1;
  int out_flags = mode == 2 ? O_WRONLY : O_WRONLY | O_CREAT | O_TRUNC;
  if (posix_spawn_file_actions_addopen(actions, STDOUT_FILENO, out, out_flags, 0600) != 0) return -1;
  if (posix_spawn_file_actions_addopen(actions, STDERR_FILENO, err, out_flags, 0600) != 0) return -1;
  return 0;
}

static int wait_child(pid_t pid, int timeout_ms, char *status, int status_cap) {
  int elapsed = 0;
  for (;;) {
    int st = 0;
    pid_t got = waitpid(pid, &st, timeout_ms > 0 ? WNOHANG : 0);
    if (got == pid) {
      if (WIFEXITED(st)) write_status(status, status_cap, WEXITSTATUS(st), 0, (int)pid, 0);
      else if (WIFSIGNALED(st)) write_status(status, status_cap, -1, WTERMSIG(st), (int)pid, 0);
      else write_status(status, status_cap, -1, 0, (int)pid, 0);
      return 0;
    }
    if (got < 0) {
      if (errno == EINTR) continue;
      return fail();
    }
    if (timeout_ms > 0 && elapsed >= timeout_ms) {
      kill(pid, SIGKILL);
      while (waitpid(pid, &st, 0) < 0 && errno == EINTR) {
      }
      write_status(status, status_cap, -1, SIGKILL, (int)pid, 1);
      return -ETIMEDOUT;
    }
    usleep(5000);
    elapsed += 5;
  }
}

int sh_spawn(const char *file, const char *argv_packed, const char *env_packed, const char *cwd, int mode,
             const char *out_path, const char *err_path, int timeout_ms, char *status, int status_cap) {
  posix_spawn_file_actions_t actions;
  posix_spawnattr_t attr;
  int actions_ready = 0;
  int attr_ready = 0;
  char **argv = NULL;
  char **envp = NULL;
  int rc = posix_spawn_file_actions_init(&actions);
  if (rc != 0) return -rc;
  actions_ready = 1;
  rc = posix_spawnattr_init(&attr);
  if (rc != 0) {
    rc = -rc;
    goto done;
  }
  attr_ready = 1;
  if (cwd && cwd[0]) {
#if defined(__APPLE__)
    rc = posix_spawn_file_actions_addchdir(&actions, cwd);
#else
    rc = posix_spawn_file_actions_addchdir_np(&actions, cwd);
#endif
    if (rc != 0) {
      rc = -rc;
      goto done;
    }
  }
  if (add_stdio(&actions, mode, out_path, err_path) != 0) {
    rc = -errno;
    goto done;
  }
  argv = unpack(argv_packed);
  if (!argv) {
    rc = -EINVAL;
    goto done;
  }
  envp = unpack(env_packed);
  pid_t pid = 0;
  rc = posix_spawnp(&pid, file, &actions, &attr, argv, envp ? envp : environ);
  if (rc != 0) {
    write_status(status, status_cap, -1, 0, 0, 0);
    rc = -rc;
    goto done;
  }
  rc = wait_child(pid, timeout_ms, status, status_cap);
done:
  free(argv);
  free(envp);
  if (attr_ready) posix_spawnattr_destroy(&attr);
  if (actions_ready) posix_spawn_file_actions_destroy(&actions);
  return rc;
}

int sh_spawn_detached(const char *file, const char *argv_packed, const char *env_packed, const char *cwd, char *status, int status_cap) {
  posix_spawn_file_actions_t actions;
  posix_spawnattr_t attr;
  int actions_ready = 0;
  int attr_ready = 0;
  char **argv = NULL;
  char **envp = NULL;
  int rc = posix_spawn_file_actions_init(&actions);
  if (rc != 0) return -rc;
  actions_ready = 1;
  rc = posix_spawnattr_init(&attr);
  if (rc != 0) {
    rc = -rc;
    goto done;
  }
  attr_ready = 1;
  rc = posix_spawnattr_setflags(&attr, POSIX_SPAWN_SETSID);
  if (rc != 0) {
    rc = -rc;
    goto done;
  }
  if (cwd && cwd[0]) {
#if defined(__APPLE__)
    rc = posix_spawn_file_actions_addchdir(&actions, cwd);
#else
    rc = posix_spawn_file_actions_addchdir_np(&actions, cwd);
#endif
    if (rc != 0) {
      rc = -rc;
      goto done;
    }
  }
  if (add_stdio(&actions, 2, NULL, NULL) != 0) {
    rc = -errno;
    goto done;
  }
  argv = unpack(argv_packed);
  if (!argv) {
    rc = -EINVAL;
    goto done;
  }
  envp = unpack(env_packed);
  pid_t pid = 0;
  rc = posix_spawnp(&pid, file, &actions, &attr, argv, envp ? envp : environ);
  if (rc != 0) {
    write_status(status, status_cap, -1, 0, 0, 0);
    rc = -rc;
    goto done;
  }
  write_status(status, status_cap, 0, 0, (int)pid, 0);
  rc = 0;
done:
  free(argv);
  free(envp);
  if (attr_ready) posix_spawnattr_destroy(&attr);
  if (actions_ready) posix_spawn_file_actions_destroy(&actions);
  return rc;
}
