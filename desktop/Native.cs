using System;
using System.Runtime.InteropServices;
using System.Threading;

namespace Proofmark
{
    /// <summary>Win32 calls: window styles for overlay windows, cursor position, DPI, and typing into the focused app.</summary>
    internal static class Native
    {
        public const int GWL_EXSTYLE = -20;
        public const int WS_EX_TRANSPARENT = 0x00000020;
        public const int WS_EX_TOOLWINDOW = 0x00000080;
        public const int WS_EX_NOACTIVATE = 0x08000000;
        public const uint SWP_NOACTIVATE = 0x0010;
        public const uint SWP_SHOWWINDOW = 0x0040;
        public static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
        public const ushort VK_SHIFT = 0x10, VK_RETURN = 0x0D, VK_DELETE = 0x2E;

        [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] private static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int index);
        [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")] private static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int index, IntPtr value);
        [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
        [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
        [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT point);
        [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
        [DllImport("user32.dll")] private static extern IntPtr MonitorFromPoint(POINT pt, uint flags);
        [DllImport("shcore.dll")] private static extern int GetDpiForMonitor(IntPtr monitor, int type, out uint dpiX, out uint dpiY);
        [DllImport("user32.dll", SetLastError = true)] private static extern uint SendInput(uint count, INPUT[] inputs, int size);

        [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }

        [StructLayout(LayoutKind.Sequential)] private struct INPUT { public uint type; public InputUnion U; }
        [StructLayout(LayoutKind.Explicit)] private struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
        [StructLayout(LayoutKind.Sequential)] private struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
        [StructLayout(LayoutKind.Sequential)] private struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
        private const uint INPUT_KEYBOARD = 1, KEYEVENTF_KEYUP = 0x2, KEYEVENTF_UNICODE = 0x4;

        public static void AddExStyle(IntPtr hWnd, int bits)
        {
            long cur = GetWindowLongPtr(hWnd, GWL_EXSTYLE).ToInt64();
            SetWindowLongPtr(hWnd, GWL_EXSTYLE, new IntPtr(cur | (long)bits));
        }

        /// <summary>Display scale (1.0 = 100%) of the monitor containing a point given in physical pixels.</summary>
        public static double ScaleAt(double x, double y)
        {
            try
            {
                IntPtr mon = MonitorFromPoint(new POINT { X = (int)x, Y = (int)y }, 2 /* MONITOR_DEFAULTTONEAREST */);
                if (GetDpiForMonitor(mon, 0 /* MDT_EFFECTIVE_DPI */, out uint dpiX, out _) == 0 && dpiX > 0) return dpiX / 96.0;
            }
            catch { }
            return 1.0;
        }

        /// <summary>The whole desktop across all monitors, in physical pixels.</summary>
        public static System.Windows.Rect VirtualScreen()
        {
            return new System.Windows.Rect(GetSystemMetrics(76), GetSystemMetrics(77), GetSystemMetrics(78), GetSystemMetrics(79));
        }

        private static INPUT Key(ushort vk, ushort scan, uint flags) =>
            new INPUT { type = INPUT_KEYBOARD, U = new InputUnion { ki = new KEYBDINPUT { wVk = vk, wScan = scan, dwFlags = flags } } };

        private static void Send(params INPUT[] inputs) => SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<INPUT>());

        public static void PressKey(ushort vk) => Send(Key(vk, 0, 0), Key(vk, 0, KEYEVENTF_KEYUP));

        /// <summary>Types text into whatever has keyboard focus. Line breaks are sent as Shift+Enter so chat apps don't send the message.</summary>
        public static void TypeText(string text)
        {
            foreach (char c in text)
            {
                if (c == '\r') continue;
                if (c == '\n')
                {
                    Send(Key(VK_SHIFT, 0, 0), Key(VK_RETURN, 0, 0), Key(VK_RETURN, 0, KEYEVENTF_KEYUP), Key(VK_SHIFT, 0, KEYEVENTF_KEYUP));
                }
                else
                {
                    Send(Key(0, c, KEYEVENTF_UNICODE), Key(0, c, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP));
                }
                if (text.Length > 200) Thread.Sleep(1);
            }
        }
    }
}
