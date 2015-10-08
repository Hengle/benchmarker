﻿using Benchmarker;
using bm = Benchmarker.Models;
using System;
using System.Text.RegularExpressions;
using Common.Logging.Simple;
using Common.Logging;
using Npgsql;
using System.Collections.Generic;
using Xamarin.TestCloud.Api.V0;
using Nito.AsyncEx;

namespace xtclog
{
	class MainClass
	{
		static void UsageAndExit (bool success)
		{
			Console.WriteLine ("Usage:");
			Console.WriteLine ("    xtcloghelper.exe --push XTCJOBID");
			Console.WriteLine ("                     --crawl-logs");
			Environment.Exit (success ? 0 : 1);
		}

		public static void Main (string[] args)
		{
			LogManager.Adapter = new ConsoleOutLoggerFactoryAdapter();
			Logging.SetLogging (LogManager.GetLogger<MainClass> ());

			if (args.Length == 0)
				UsageAndExit (true);

			if (args [0] == "--push") {
				if (args.Length <= 1) {
					UsageAndExit (false);
				}
				string xtcJobId = args [1];
				var connection = PostgresInterface.Connect ();
				PushXTCJobId (connection, xtcJobId);
			} else if (args [0] == "--crawl-logs") {
				var connection = PostgresInterface.Connect ();
				var xtcapikey = Accredit.GetCredentials ("xtcapikey") ["xtcapikey"].ToString ();
				var xtcapi = new Client (xtcapikey);

				foreach (var xtcjobid in PullXTCJobIds (connection)) {
					Console.WriteLine ("XTC Job ID Pending: " + xtcjobid);
					var guid = Guid.Parse (xtcjobid);
					Console.WriteLine ("guid: \"{0}\"", guid);
					ResultCollection results = AsyncContext.Run (() => xtcapi.TestRuns.Results (guid));
					Console.WriteLine ("finished? " + results.Finished);
				}
				string text = System.IO.File.ReadAllText("/Users/bernhardu/work/benchmarker/tools/device-log-test.log");
				var runSet = ProcessLog (text);
				// TODO: runSet.UploadToPostgres (dbConnection, machine);
			} else {
				UsageAndExit (false);
			}
		}

		private static void PushXTCJobId(NpgsqlConnection conn, string xtcJobId) {
			PostgresRow row = new PostgresRow ();
			row.Set ("job", NpgsqlTypes.NpgsqlDbType.Varchar, xtcJobId);
			PostgresInterface.Insert<long> (conn, "XamarinTestcloudJobIDs", row, "id");
		}

		private static List<string> PullXTCJobIds(NpgsqlConnection conn) {
			var l = new List<string> ();
			foreach (var s in PostgresInterface.Select (conn, "XamarinTestcloudJobIDs", new string[] {"job"}, null, null)) {
				l.Add (s.GetReference<string> ("job"));
			}
			return l;
		}

		private static bm.RunSet ProcessLog(string log) {
			string logURL = null; // TODO
			string regex_commit = @"I\/benchmarker\(\s*\d+\): Benchmarker \| commit ""(?<hash>[0-9A-Za-z]{40})"" on branch ""(?<branch>[\w\-_\.]+)""";
			Match match_commit = Regex.Match (log, regex_commit);
			var commit = new bm.Commit ();
			commit.Hash = match_commit.Groups ["hash"].Value;
			commit.Branch = match_commit.Groups ["branch"].Value;

			string regex_machine = @"I\/benchmarker\(\s*\d+\): Benchmarker \| hostname ""(?<hostname>[\w\s\.]+)"" architecture ""(?<architecture>[\w\-]+)""";
			Match match_machine = Regex.Match (log, regex_machine);
			var machine = new bm.Machine {
				Name = match_machine.Groups ["hostname"].Value,
				Architecture = match_machine.Groups ["architecture"].Value
			};

			string regex_config = @"I\/benchmarker\(\s*\d+\): Benchmarker \| configname ""(?<name>[\w\-\.]+)""";
			Match match_config = Regex.Match (log, regex_config);
			var config = new bm.Config {
				Name = match_config.Groups ["name"].Value,
				Mono = String.Empty,
				MonoOptions = new string[0],
				MonoEnvironmentVariables = new Dictionary<string, string> (),
				Count = 10
			};

			var runSet = new bm.RunSet {
				StartDateTime = DateTime.Now, // TODO: get more precise data from log
				Config = config,
				Commit = commit,
				LogURL = logURL
			};
			
			string regex_runs = @"I\/benchmarker\(\s*\d+\): Benchmarker \| Benchmark ""(?<name>[\w\-_\d]+)"": finished iteration (?<iteration>\d+), took (?<time>\d+)ms";
			Dictionary<string, List<TimeSpan>> bench_results = new Dictionary<string, List<TimeSpan>> ();
			foreach (Match match_run in Regex.Matches(log, regex_runs)) {
				string name = match_run.Groups ["name"].Value;
				string iteration = match_run.Groups ["iteration"].Value;
				string time = match_run.Groups ["time"].Value;

				if (!bench_results.ContainsKey (name)) {
					bench_results.Add (name, new List<TimeSpan> ());
				}
				bench_results [name].Add (TimeSpan.FromMilliseconds (Int64.Parse (time)));
				Console.WriteLine ("{0}, Iteration #{1}: {2}ms", name, iteration, time);
			}

			foreach (string benchmark in bench_results.Keys) {
				var result = new bm.Result {
					DateTime = DateTime.Now,
					Benchmark = new bm.Benchmark { Name = benchmark},
					Config = config
				};

				foreach (TimeSpan t in bench_results[benchmark]) {
					var run = new bm.Result.Run ();
					run.RunMetrics.Add (new bm.Result.RunMetric {
						Metric = bm.Result.RunMetric.MetricType.Time,
						Value = t
					});
					result.Runs.Add (run);
				}
				runSet.Results.Add (result);
			}
			return runSet;
		}
	}
}
