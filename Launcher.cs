using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal static class Launcher
{
    private static string Q(string value) { return "\"" + value.Replace("\"", "\\\"") + "\""; }
    [STAThread]
    private static int Main(string[] args)
    {
        string command = args.Length == 0 ? "launch" : args[0].TrimStart('-', '/');
        if (command != "launch" && command != "restore" && command != "apply" && command != "disable" && command != "probe") return 2;
        string root = AppDomain.CurrentDomain.BaseDirectory;
        string user = WindowsIdentity.GetCurrent().User.Value.Replace('-', '_');
        bool created;
        using (var mutex = new Mutex(false, "Local\\ChatGPTWideWindowsCommunity_" + user, out created))
        {
            bool acquired = false;
            try
            {
                try { acquired = mutex.WaitOne(0); } catch (AbandonedMutexException) { acquired = true; }
                if (!acquired) return 0;
                if (command == "disable" && MessageBox.Show("恢复官方启动方式，并取消以后默认加宽？", "ChatGPT", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return 0;
                var json = new JavaScriptSerializer();
                string configPath = Path.Combine(root, "runtime.local.json");
                var config = json.Deserialize<Dictionary<string, object>>(File.ReadAllText(configPath, Encoding.UTF8));
                string node = Convert.ToString(config["nodeExe"]);
                var start = new ProcessStartInfo(node, Q(Path.Combine(root, "entry.mjs")) + " " + Q(configPath) + " " + command);
                start.UseShellExecute = false;
                start.CreateNoWindow = true;
                start.WindowStyle = ProcessWindowStyle.Hidden;
                start.RedirectStandardOutput = true;
                start.RedirectStandardError = true;
                start.StandardOutputEncoding = Encoding.UTF8;
                start.StandardErrorEncoding = Encoding.UTF8;
                start.WorkingDirectory = root;
                using (var process = Process.Start(start))
                {
                    string output = process.StandardOutput.ReadToEnd();
                    process.StandardError.ReadToEnd();
                    process.WaitForExit();
                    var result = json.Deserialize<Dictionary<string, object>>(output);
                    bool ok = result.ContainsKey("ok") && Convert.ToBoolean(result["ok"]);
                    Directory.CreateDirectory(Path.Combine(root, "state"));
                    File.WriteAllText(Path.Combine(root, "state", "last-launcher-result.json"), output, new UTF8Encoding(false));
                    if (command != "probe" && result.ContainsKey("notice") && result["notice"] != null)
                        MessageBox.Show(Convert.ToString(result["notice"]), "ChatGPT", MessageBoxButtons.OK, ok ? MessageBoxIcon.Information : MessageBoxIcon.Warning);
                    return ok ? 0 : 1;
                }
            }
            catch
            {
                if (command != "probe") MessageBox.Show("ChatGPT 宽屏启动检查未完成。当前客户端没有被关闭；可使用恢复官方启动方式入口。", "ChatGPT", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return 1;
            }
            finally { if (acquired) mutex.ReleaseMutex(); }
        }
    }
}
