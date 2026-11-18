using System;
using System.Threading;
using System.Windows;

namespace Proofmark
{
    public static class Program
    {
        [STAThread]
        public static void Main()
        {
            using var single = new Mutex(true, "Proofmark.Desktop.SingleInstance", out bool first);
            if (!first)
            {
                MessageBox.Show("Proofmark is already running. Look for its icon in the system tray, next to the clock.", "Proofmark");
                return;
            }
            var app = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
            app.DispatcherUnhandledException += (_, e) =>
            {
                Log.Write("unhandled: " + e.Exception);
                e.Handled = true;
            };
            var controller = new Controller(app);
            app.Startup += async (_, _) => await controller.StartAsync();
            app.Run();
        }
    }
}
