import {
  appendFileSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync,
  realpathSync, renameSync, rmSync, statSync, statfsSync, symlinkSync, unlinkSync, writeFileSync,
} from "./fs.js";

const api = {
  appendFile: appendFileSync,
  link: linkSync,
  lstat: lstatSync,
  mkdir: mkdirSync,
  mkdtemp: mkdtempSync,
  readFile: readFileSync,
  readdir: readdirSync,
  readlink: readlinkSync,
  realpath: realpathSync,
  rename: renameSync,
  rm: rmSync,
  stat: statSync,
  statfs: statfsSync,
  symlink: symlinkSync,
  unlink: unlinkSync,
  writeFile: writeFileSync,
};

function promised(fn) {
  return (...args) => {
    try {
      return Promise.resolve(fn(...args));
    } catch (error) {
      return Promise.reject(error);
    }
  };
}

export const readFile = promised(api.readFile);
export const writeFile = promised(api.writeFile);
export const appendFile = promised(api.appendFile);
export const mkdir = promised(api.mkdir);
export const readdir = promised(api.readdir);
export const rm = promised(api.rm);
export const lstat = promised(api.lstat);
export const stat = promised(api.stat);
export const statfs = promised(api.statfs);
export const link = promised(api.link);
export const realpath = promised(api.realpath);
export const readlink = promised(api.readlink);
export const rename = promised(api.rename);
export const symlink = promised(api.symlink);
export const mkdtemp = promised(api.mkdtemp);
export const unlink = promised(api.unlink);

export default {
  readFile, writeFile, appendFile, mkdir, readdir, rm, lstat, stat, statfs, link, realpath, readlink, rename, symlink, mkdtemp, unlink,
};
