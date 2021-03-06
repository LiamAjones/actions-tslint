"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

const core = require("@actions/core");
const github = require("@actions/github");
const common_tags_1 = require("common-tags");
const fs = require("fs");
const glob = require("glob");
const tslint = require("tslint");
const { error } = require("console");
const MAX_ANNOTATIONS = 50;

const SeverityAnnotationLevelMap = new Map([
    ["warning", "warning"],
    ["error", "failure"],
]);
(async () => {
    const ctx = github.context;

    const tslintConfigFile = core.getInput("tslintConfigFile");
    const pattern = core.getInput("pattern");
    const github_token = core.getInput("token");

    if (!pattern) {
        core.setFailed("tslint-actions: Please set project or pattern input");
        return;
    }
    if (!github_token) {
        core.setFailed("tslint-actions: Please set token");
        return;
    }
    
    core.debug('ts config file' + tslintConfigFile);
    core.debug('pattern' + pattern);

    const octokit = new github.getOctokit(github_token);

    const check = await octokit.checks.create({
        owner: ctx.repo.owner,
        repo: ctx.repo.repo,
        name: "TSLint Action",
        head_sha: ctx.sha,
        status: "in_progress",
    });

    const result = (() => {

        const linter = new tslint.Linter({
            fix: false,
            formatter: "json"
        });
        const files = glob.sync(pattern);

        if (!files) {
            core.debug('Files is undefined');
        }

        core.debug(JSON.stringify(tslint.Configuration.readConfigurationFile(tslintConfigFile), null, 2));

        core.debug('FILES FOUND : ' + files.length);

        for (const file of files) {

            core.debug(file);

            const fileContents = fs.readFileSync(file, { encoding: "utf8" });
            const configuration = tslint.Configuration.findConfiguration(tslintConfigFile, file).results;
            linter.lint(file, fileContents, configuration);
        }

        return linter.getResult();
    })();

    core.debug(result.errorCount);

    const annotations = result.failures.map(failure => {
        core.debug('Failure');
        return ({
            path: failure.getFileName(),
            start_line: failure.getStartPosition().getLineAndCharacter().line,
            end_line: failure.getEndPosition().getLineAndCharacter().line,
            annotation_level: SeverityAnnotationLevelMap.get(failure.getRuleSeverity()) || "notice",
            message: `[${failure.getRuleName()}] ${failure.getFailure()}`,
        })
    });

    const conclusion = result.errorCount > 0 ? "failure" : "success";

    core.debug(conclusion);

    const sendData = (async (annotations) => {
        const ocktoData = {
            owner: ctx.repo.owner,
            repo: ctx.repo.repo,
            check_run_id: check.data.id,
            name: "TSLint Action",
            status: "completed",
            conclusion: conclusion,
            output: {
                title: "TSLint Action",
                summary: `${result.errorCount} error(s), ${result.warningCount} warning(s) found`,
                annotations,
            }
        };

        core.debug(ocktoData)

        const wait = await octokit.checks.update(ocktoData);

        core.debug(wait);
    });

    if (annotations.length <= 50) {
        await sendData(annotations);
    } else {
        while (annotations.length !== 0) {
            await sendData(annotations.splice(0, MAX_ANNOTATIONS));
        }
    }

})().catch((e) => {
    core.setFailed(e.message);
});