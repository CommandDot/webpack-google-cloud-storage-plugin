import Promise from "bluebird";
import PropTypes from "prop-types";
import { Storage } from "@google-cloud/storage";
import path from "path";

import { pick } from "./utils";
import { uploadFile } from "./gcp";

const recursive = Promise.promisify(require("recursive-readdir"));

const pluginName = "WebpackGoogleCloudStoragePlugin";

const hook = (compiler, cb) => {
  // new webpack
  if (compiler.hooks) {
    compiler.hooks.afterEmit.tapAsync(pluginName, cb);
    return;
  }
  // old webpack
  compiler.plugin("after-emit", cb);
};

module.exports = class WebpackGoogleCloudStoragePlugin {
  static get schema() {
    return {
      directory: PropTypes.string,
      include: PropTypes.array,
      exclude: PropTypes.array,
      storageOptions: PropTypes.object.isRequired,
      uploadOptions: PropTypes.shape({
        bucketName: PropTypes.string.isRequired,
        forceCreateBucket: PropTypes.bool,
        gzip: PropTypes.bool,
        public: PropTypes.bool,
        destinationNameFn: PropTypes.func,
        metadataFn: PropTypes.func,
        makePublic: PropTypes.bool,
        resumable: PropTypes.bool,
        concurrency: PropTypes.number,
      }),
    };
  }

  static get ignoredFiles() {
    return [".DS_Store"].map((pattern) => new RegExp(pattern));
  }

  static defaultDestinationNameFn(file) {
    return file.path;
  }

  /**
   * Return an object following this schema:
   *
   * - https://cloud.google.com/nodejs/docs/reference/storage/2.0.x/Bucket#upload
   * - https://cloud.google.com/storage/docs/json_api/v1/objects/insert#request_properties_JSON
   * - Example: https://github.com/googleapis/nodejs-storage/blob/master/samples/files.js#L119
   *
   * @param {*} file { path: string }
   */
  static defaultMetadataFn(/* file */) {
    return {};
  }

  static getAssetFiles({ assets }) {
    const files = assets.map((value, name) => ({ name, path: value.existsAt }));
    return Promise.resolve(files);
  }

  static handleErrors(error, compilation, cb) {
    compilation.errors.push(new Error(`${pluginName}: ${error.stack}`));
    cb();
  }

  static regexpToIgnoreFunction(regexp) {
    return (file) => regexp.test(file);
  }

  constructor(options = {}) {
    PropTypes.validateWithErrors(this.constructor.schema, options, pluginName);

    this.isConnected = false;

    this.storageOptions = options.storageOptions;
    this.uploadOptions = options.uploadOptions;
    this.uploadOptions.destinationNameFn =
      this.uploadOptions.destinationNameFn ||
      this.constructor.defaultDestinationNameFn;
    this.uploadOptions.metadataFn =
      this.uploadOptions.metadataFn || this.constructor.defaultMetadataFn;

    this.options = pick(options, [
      "directory",
      "include",
      "exclude",
      "basePath",
    ]);

    // transform the RegExp patterns immediately to minimize regexp object creation
    this.options.exclude = (this.options.exclude || []).map(
      (pattern) => new RegExp(pattern)
    );
    this.options.include = (this.options.include || []).map(
      (pattern) => new RegExp(pattern)
    );
  }

  connect() {
    if (this.isConnected) {
      return;
    }

    this.client = new Storage(this.storageOptions);

    this.isConnected = true;
  }

  filterFiles(files) {
    return Promise.resolve(
      files.filter(
        (file) =>
          this.isIncluded(file.name) &&
          !this.isExcluded(file.name) &&
          !this.isIgnored(file.name)
      )
    );
  }

  isIncluded(fileName) {
    return this.options.include.some((regexp) => fileName.match(regexp));
  }

  isExcluded(fileName) {
    return this.options.exclude.some((regexp) => fileName.match(regexp));
  }

  isIgnored(fileName) {
    return this.constructor.ignoredFiles.some((regexp) =>
      fileName.match(regexp)
    );
  }

  handleFiles(files) {
    return this.filterFiles(files).then((filteredFiles) =>
      this.uploadFiles(filteredFiles)
    );
  }

  apply(compiler) {
    this.connect();

    // NOTE: Use specified directory, webpack.config.output or current dir.
    this.options.directory =
      this.options.directory ||
      compiler.options.output.path ||
      compiler.options.output.context ||
      ".";
    hook(compiler, (compilation, cb) => {
      if (this.options.directory) {
        recursive(
          this.options.directory,
          // recursive-readdr expects glob formats, convert our regexps to function so it will
          // be compatible
          this.options.exclude.map(this.constructor.regexpToIgnoreFunction)
        )
          .then((files) =>
            files.map((f) => ({ name: path.basename(f), path: f }))
          )
          .then((files) => this.handleFiles(files))
          .then(() => cb())
          .catch((e) => this.constructor.handleErrors(e, compilation, cb));
      } else {
        this.constructor
          .getAssetFiles(compilation)
          .then((files) => this.handleFiles(files))
          .then(() => cb())
          .catch((e) => this.constructor.handleErrors(e, compilation, cb));
      }
    });
  }

  uploadFiles(files = []) {
    return Promise.map(files, (file) =>
      uploadFile(
        this.client,
        this.uploadOptions.bucketName,
        file,
        this.uploadOptions.destinationNameFn(file),
        this.uploadOptions.metadataFn(file),
        this.uploadOptions.gzip || false,
        this.uploadOptions.makePublic || false
      )
    );
  }
};
