//go:build windows

package main

import (
  "fmt"
  "os"
  "os/exec"
  "path/filepath"
  "syscall"
  "unsafe"
  "time"
)

func showError(err error) {
  text, _ := syscall.UTF16PtrFromString(fmt.Sprintf("Delivery Studio could not start. Extract the entire download before opening Delivery Studio.exe. Your saved workspace remains on this computer.\n\n%v", err))
  title, _ := syscall.UTF16PtrFromString("Delivery Studio")
  syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(text)), uintptr(unsafe.Pointer(title)), 0x10)
}

func main() {
  executable, err := os.Executable()
  if err != nil { showError(err); return }
  root := filepath.Join(filepath.Dir(executable), "resources")
  node := filepath.Join(root, "runtime", "node.exe")
  script := filepath.Join(root, "launcher.mjs")
  command := exec.Command(node, script)
  command.Env = append(os.Environ(), fmt.Sprintf("DELIVERY_STUDIO_LAUNCHED_AT=%d", time.Now().UnixMilli()))
  command.Dir = root
  command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
  if err := command.Start(); err != nil { showError(err) }
}
