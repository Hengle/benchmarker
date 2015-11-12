///<reference path="../typings/react/react.d.ts"/>
///<reference path="../typings/amcharts/AmCharts.d.ts"/>

/* @flow */

/* global AmCharts, AmChart */

"use strict";

import * as xp_common from './common.tsx';
import * as xp_utils from './utils.ts';
import * as Database from './database.ts';
import React = require ('react');

type Range = [number, number, number, number];

function calculateRunsRange (data: Array<number>) : Range {
	var min: number;
	var max: number;
	var sum = 0;
	var v;
	for (var i = 0; i < data.length; ++i) {
		v = data [i];
		if (min === undefined || v < min)
			min = v;
		if (max === undefined || v > max)
			max = v;
		sum += v;
	}
	var mean = sum / data.length;
	sum = 0;
	for (i = 0; i < data.length; ++i) {
		v = data [i];
		var diff = v - mean;
		sum += diff * diff;
	}
	var stddev = Math.sqrt (sum) / data.length;
	if (min === undefined || max === undefined)
		min = max = 0;
	return [min, mean - stddev, mean + stddev, max];
}

function normalizeRange (mean: number, range: Range) : Range {
	return [range [0] / mean, range [1] / mean, range [2] / mean, range [3] / mean];
}

function rangeMean (range: Range) : number {
	return (range [1] + range [2]) / 2;
}

type BenchmarkRow = [string, Array<Range>];
type DataArray = Array<BenchmarkRow>;

function dataArrayForResults (resultsByIndex: Array<{[benchmark: string]: Object}>) : DataArray {
	for (var i = 0; i < resultsByIndex.length; ++i) {
		if (resultsByIndex [i] === undefined)
			return undefined;
	}

	var commonBenchmarkNames;

	for (i = 0; i < resultsByIndex.length; ++i) {
		var results = resultsByIndex [i];
		var benchmarkNames = Object.keys (results);
		if (commonBenchmarkNames === undefined) {
			commonBenchmarkNames = benchmarkNames;
			continue;
		}
		commonBenchmarkNames = xp_utils.intersectArray (benchmarkNames, commonBenchmarkNames);
	}

	if (commonBenchmarkNames === undefined || commonBenchmarkNames.length === 0)
		return;

	commonBenchmarkNames.sort ();

	var dataArray = [];

	for (i = 0; i < commonBenchmarkNames.length; ++i) {
		var benchmarkName = commonBenchmarkNames [i];
		var row = [benchmarkName, []];
		var mean = undefined;
		for (var j = 0; j < resultsByIndex.length; ++j) {
			var data = resultsByIndex [j][benchmarkName]['results'];
			var range = calculateRunsRange (data);
			if (mean === undefined)
				mean = rangeMean (range);
			row [1].push (normalizeRange (mean, range));
		}
		dataArray.push (row);
	}

	return dataArray;
}

function rangeInBenchmarkRow (row: BenchmarkRow, runSetIndex: number) : Range {
	return row [1] [runSetIndex];
}

// FIXME: use geometric mean
function runSetMean (dataArray: DataArray, runSetIndex: number) : number {
	var sum = 0;
	for (var i = 0; i < dataArray.length; ++i) {
		var range = rangeInBenchmarkRow (dataArray [i], runSetIndex);
		sum += rangeMean (range);
	}
	return sum / dataArray.length;
}

function sortDataArrayByDifference (dataArray: DataArray) : DataArray {
	var differences = {};
	for (var i = 0; i < dataArray.length; ++i) {
		let row = dataArray [i];
		var min = Number.MAX_VALUE;
		var max = Number.MIN_VALUE;
		for (var j = 0; j < row [1].length; ++j) {
			var avg = rangeMean (rangeInBenchmarkRow (row, j));
			if (min === undefined) {
				min = avg;
			} else {
				min = Math.min (min, avg);
			}
			if (max === undefined) {
				max = avg;
			} else {
				max = Math.max (max, avg);
			}
		}
		differences [row [0]] = max - min;
	}
	return xp_utils.sortArrayNumericallyBy (dataArray, (row: BenchmarkRow) => -differences [row [0]]);
}

function runSetLabels (runSets: Array<Database.DBRunSet>) : Array<string> {
	var commitHashes = runSets.map ((rs: Database.DBRunSet) => rs.commit.get ('hash'));
	var commitHistogram = xp_utils.histogramOfStrings (commitHashes);

	var includeCommit = commitHistogram.length > 1;

	var includeStartedAt = false;
	for (var i = 0; i < commitHistogram.length; ++i) {
		if (commitHistogram [i] [1] > 1)
			includeStartedAt = true;
	}

	var machines = runSets.map ((rs: Database.DBRunSet) => rs.machine.get ('name'));
	var includeMachine = xp_utils.uniqStringArray (machines).length > 1;

	var configs = runSets.map ((rs: Database.DBRunSet) => rs.config.get ('name'));
	var includeConfigs = xp_utils.uniqStringArray (configs).length > 1;

	var formatRunSet = (runSet: Database.DBRunSet) => {
		var str = "";
		if (includeCommit) {
			var commit = runSet.commit;
			str = commit.get ('hash') + " (" + commit.get ('commitDate') + ")";
		}
		if (includeMachine) {
			var machine = runSet.machine;
			if (str !== "")
				str = str + "\n";
			str = str + machine.get ('name');
		}
		if (includeConfigs) {
			var config = runSet.config;
			if (includeMachine) {
				str = str + " / ";
			} else if (str !== "") {
				str = str + "\n";
			}
			str = str + config.get ('name');
		}
		if (includeStartedAt) {
			if (str !== "")
				str = str + "\n";
			str = str + runSet.get ('startedAt');
		}
		return str;
	};

	return runSets.map (formatRunSet);
}

type AMChartProps = {
	graphName: string;
	height: number;
	options: any;
	selectListener: (dataItem: any) => void;
    initFunc: (chart: AmCharts.AmSerialChart) => void;
};

export class AMChart extends React.Component<AMChartProps, void> {
	private chart: AmCharts.AmSerialChart;

	public render () : JSX.Element {
		return React.DOM.div({
			className: 'AMChart',
			id: this.props.graphName,
			style: {height: this.props.height}
		});
	}

	public componentDidMount () : void {
		this.drawChart (this.props);
	}

	public componentWillUnmount () : void {
		this.chart.clear ();
	}

	public shouldComponentUpdate (nextProps: AMChartProps, nextState: void) : boolean {
		if (this.props.graphName !== nextProps.graphName)
			return true;
		if (this.props.height !== nextProps.height)
			return true;
		if (!xp_utils.deepEquals (this.props.options, nextProps.options))
			return true;
		// FIXME: what do we do with the selectListener?
		return false;
	}

	public componentDidUpdate () : void {
		this.drawChart (this.props);
	}

	private drawChart (props: AMChartProps) : void {
		if (this.chart === undefined) {
			/*
			 * AMCharts will modify `options.graphs`, so unless we clone it,
			 * we can't later compare with it to check whether we need to
			 * update.
			 */
			var options = xp_utils.shallowClone (props.options);
			options.graphs = xp_utils.deepClone (options.graphs);
			this.chart = AmCharts.makeChart (props.graphName, options) as AmCharts.AmSerialChart;
			if (this.props.selectListener !== undefined)
				this.chart.addListener (
					'clickGraphItem',
					(e: AmCharts.AmCoordinateChartEvent) => this.props.selectListener ((e.item.dataContext as any).dataItem));
			if (this.props.initFunc !== undefined)
				this.props.initFunc (this.chart);
		} else {
			this.chart.graphs = xp_utils.deepClone (this.props.options.graphs);
			this.chart.dataProvider = this.props.options.dataProvider;
			var valueAxis = this.props.options.valueAxes [0];
			if (valueAxis.minimum !== undefined) {
				this.chart.valueAxes [0].minimum = valueAxis.minimum;
				this.chart.valueAxes [0].maximum = valueAxis.maximum;
			}
			if (valueAxis.guides !== undefined)
				this.chart.valueAxes [0].guides = valueAxis.guides;
			this.chart.valueAxes [0].title = valueAxis.title;
			this.chart.validateData ();
			if (this.props.initFunc !== undefined)
				this.props.initFunc (this.chart);
		}
	}
}

function formatPercentage (x: number) : string {
	return (x * 100).toPrecision (4) + "%";
}

type ComparisonAMChartProps = {
    runSets: Array<Database.DBRunSet>;
	metric: string;
	runSetLabels: Array<string> | void;
	graphName: string;
};

export class ComparisonAMChart extends React.Component<ComparisonAMChartProps, void> {
    private resultsByIndex: Array<{[benchmark: string]: Object}>;
    private graphs: Array<Object>;
    private dataProvider: Array<Object>;
    private min: number | void;
    private max: number | void;
	private guides: Array<Object>;

    constructor (props: ComparisonAMChartProps) {
		super (props);

		this.invalidateState (props.runSets);
    }

    public componentWillReceiveProps (nextProps: ComparisonAMChartProps) : void {
		this.invalidateState (nextProps.runSets);
	}

    private invalidateState (runSets: Array<Database.DBRunSet>) : void {
        this.resultsByIndex = [];

		const runSetsString = runSets.map ((rs: Database.DBRunSet) => rs.get ('id')).join (',');
		Database.fetch ('results?metric=eq.' + this.props.metric + '&disabled=isnot.true&runset=in.' + runSetsString,
			(objs: Array<Object>) => {
				if (runSets !== this.props.runSets)
					return;

				var runSetIndexById = {};
				runSets.forEach ((rs: Database.DBRunSet, i: number) => {
					runSetIndexById [rs.get ('id')] = i;
				});

				objs.forEach ((r: Object) => {
					var i = runSetIndexById [r ['runset']];
					if (this.resultsByIndex [i] === undefined)
						this.resultsByIndex [i] = {};
					this.resultsByIndex [i][r ['benchmark']] = r;
				});

				this.runsLoaded ();
			}, (error: Object) => {
				alert ("error loading results: " + error.toString ());
			});
    }

    private runsLoaded () : void {
        var i;

        var dataArray = dataArrayForResults (this.resultsByIndex);
        if (dataArray === undefined)
            return;

		dataArray = sortDataArrayByDifference (dataArray);

        var graphs = [];
		var guides = [];
        var dataProvider = [];

        var labels = this.props.runSetLabels || runSetLabels (this.props.runSets);

        for (i = 0; i < this.props.runSets.length; ++i) {
			var label = labels [i];
			var avg = runSetMean (dataArray, i);
            var stdDevBar: Object = {
                "fillAlphas": 1,
				"lineAlpha": 0,
                "title": label,
                "type": "column",
                "openField": "stdlow" + i,
                "closeField": "stdhigh" + i,
                "switchable": false
            };
            var errorBar: Object = {
                "balloonText": "Average +/- standard deviation: [[stdBalloon" + i + "]]\n[[errorBalloon" + i + "]]",
                "bullet": "yError",
                "bulletAxis": "time",
                "bulletSize": 5,
                "errorField": "lowhigherror" + i,
                "type": "column",
                "valueField": "lowhighavg" + i,
                "lineAlpha": 0,
                "visibleInLegend": false,
                "newStack": true
            };
			var guide: Object = {
				"value": avg,
				"balloonText": label,
				"lineThickness": 3
			};
			if (this.props.runSets.length <= xp_common.xamarinColorsOrder.length) {
				var colors = xp_common.xamarinColors [xp_common.xamarinColorsOrder [i]];
				stdDevBar ["fillColors"] = colors [2];
				errorBar ["lineColor"] = colors [2];
				guide ["lineColor"] = colors [2];
			}
            graphs.push (errorBar);
            graphs.push (stdDevBar);
			guides.push (guide);
        }

        var min, max;
        for (i = 0; i < dataArray.length; ++i) {
            var row = dataArray [i];
            var entry = { "benchmark": row [0] };
            for (var j = 0; j < this.props.runSets.length; ++j) {
				var range = rangeInBenchmarkRow (row, j);
                var lowhighavg = (range [0] + range [3]) / 2;
                entry ["stdlow" + j] = range [1];
                entry ["stdhigh" + j] = range [2];
                entry ["lowhighavg" + j] = lowhighavg;
                entry ["lowhigherror" + j] = range [3] - range [0];

                if (min === undefined) {
                    min = range [0];
				} else {
                    min = Math.min (min, range [0]);
				}

                if (max === undefined) {
                    max = range [3];
				} else {
                    max = Math.max (max, range [3]);
				}

                entry ["stdBalloon" + j] = formatPercentage (range [1]) + "–" + formatPercentage (range [2]);
                entry ["errorBalloon" + j] = "Min: " + formatPercentage (range [0]) + " Max: " + formatPercentage (range [3]);
            }
            dataProvider.push (entry);
        }

        this.min = min;
        this.max = max;
        this.graphs = graphs;
		this.guides = guides;
        this.dataProvider = dataProvider;
        this.forceUpdate ();
    }

    public render () : JSX.Element {
        if (this.dataProvider === undefined)
            return <div className="diagnostic">Loading&hellip;</div>;

        var options = {
            "type": "serial",
            "theme": "default",
            "categoryField": "benchmark",
            "rotate": false,
            "startDuration": 0.3,
            "categoryAxis": {
                "gridPosition": "start"
            },
            "chartScrollbar": {
            },
            "trendLines": [],
            "graphs": this.graphs,
            "dataProvider": this.dataProvider,
            "valueAxes": [
                {
                    "id": "time",
                    "title": "Relative wall clock time",
                    "axisAlpha": 0,
                    "stackType": "regular",
                    "minimum": this.min,
                    "maximum": this.max,
					"guides": this.guides
                }
            ],
            "allLabels": [],
            "balloon": {},
            "titles": [],
            "legend": {
                "useGraphSettings": true
            }
        };

        var zoomFunc;
        if (this.dataProvider.length > 15) {
            zoomFunc = (chart: AmCharts.AmSerialChart) => {
                chart.zoomToIndexes (0, 9);
            };
        }

        return <AMChart
			selectListener={undefined}
            graphName={this.props.graphName}
            height={700}
            options={options}
            initFunc={zoomFunc} />;
    }
}

type TimelineAMChartProps = {
	graphName: string;
	height: number;
	title: string;
	data: Object;
	selectListener: (runSet: Database.DBRunSet) => void;
	zoomInterval: {start: number, end: number};
};

class TimelineAMChart extends React.Component<TimelineAMChartProps, void> {
	public render () : JSX.Element {
		var timelineOptions = {
						"type": "serial",
						"theme": "default",
						"categoryAxis": {
							"axisThickness": 0,
							"gridThickness": 0,
							"labelsEnabled": false,
							"tickLength": 0
						},
						"chartScrollbar": {
							"graph": "average"
						},
						"trendLines": [],
						"graphs": [
							{
								"balloonText": "[[lowName]]",
								"bullet": "round",
								"bulletAlpha": 0,
								"lineColor": xp_common.xamarinColors.blue [2],
								"lineThickness": 0,
								"id": "low",
								"title": "low",
								"valueField": "low"
							},
							{
								"balloonText": "[[highName]]",
								"bullet": "round",
								"bulletAlpha": 0,
								"lineColor": xp_common.xamarinColors.blue [2],
								"fillAlphas": 0.13,
								"fillToGraph": "low",
								"fillColors": xp_common.xamarinColors.blue [2],
								"id": "high",
								"lineThickness": 0,
								"title": "high",
								"valueField": "high"
							},
							{
								"balloonText": "[[tooltip]]",
								"bullet": "round",
								"bulletSize": 4,
								"lineColor": xp_common.xamarinColors.blue [2],
								"lineColorField": "lineColor",
								"id": "geomean",
								"title": "geomean",
								"valueField": "geomean"
							}

						],
						"valueAxes": [
							{
								"id": "time",
								"axisThickness": 0,
								"fontSize": 12,
								"gridAlpha": 0.07,
								"title": this.props.title
							}
						],
						"allLabels": [],
						"balloon": {},
						"titles": [],
                        "dataProvider": this.props.data
					};

		var zoomFunc;
		var zoomInterval = this.props.zoomInterval;
		if (zoomInterval !== undefined) {
			var start = zoomInterval.start;
			var end = zoomInterval.end;
            zoomFunc = ((chart: AmCharts.AmSerialChart) => {
                chart.zoomToIndexes (start, end);
            });
        }

		return <AMChart
			graphName={this.props.graphName}
			height={this.props.height}
			options={timelineOptions}
			selectListener={this.props.selectListener}
			initFunc={zoomFunc} />;
	}
}

export interface TimelineChartProps {
	graphName: string;
	metric: string;
	sortedResults: any;
	zoomInterval: {start: number, end: number};
	runSetSelected: (runSet: Database.DBObject) => void;
};

export abstract class TimelineChart<Props extends TimelineChartProps> extends React.Component<Props, void> {
	// FIXME: make private and have `computeTable` return the new table
	public table: Array<Object>;

	public valueAxisTitle () : string {
		return "";
	}

	public componentWillMount () : void {
		this.invalidateState (this.props);
	}

	public componentWillReceiveProps (nextProps: Props) : void {
		if (this.props.sortedResults === nextProps.sortedResults) {
			return;
		}
		this.invalidateState (nextProps);
	}

	public render () : JSX.Element {
		if (this.table === undefined)
			return <div className="diagnostic">Loading&hellip;</div>;

		return <TimelineAMChart
			graphName={this.props.graphName}
			height={300}
			data={this.table}
			zoomInterval={this.props.zoomInterval}
			title={this.valueAxisTitle ()}
			selectListener={(rs: Database.DBRunSet) => this.props.runSetSelected (rs)} />;
	}

	public abstract computeTable (nextProps: Props) : void;

	private invalidateState (nextProps: Props) : void {
		this.table = undefined;
		this.computeTable (nextProps);
	}
}
