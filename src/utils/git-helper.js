import { execSync } from 'child_process';
import * as core from '@actions/core';

/**
 * Git utilities for creating auto-fix branches and commits
 */
export class GitHelper {
  constructor(workspaceRoot) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Execute git command
   */
  exec(command) {
    try {
      const result = execSync(command, {
        cwd: this.workspaceRoot,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
      return result.trim();
    } catch (error) {
      throw new Error(`Git command failed: ${command}\n${error.message}`);
    }
  }

  /**
   * Configure git user for commits
   */
  configureGitUser() {
    try {
      this.exec('git config user.name "AEM Forms Performance Bot"');
      this.exec('git config user.email "performance-bot@github-actions"');
    } catch (error) {
      core.warning(`Could not configure git user: ${error.message}`);
    }
  }

  /**
   * Get current branch name
   */
  getCurrentBranch() {
    return this.exec('git rev-parse --abbrev-ref HEAD');
  }

  /**
   * Get current commit SHA
   */
  getCurrentSHA() {
    return this.exec('git rev-parse HEAD');
  }

  /**
   * Create new branch from current HEAD
   */
  createBranch(branchName) {
    core.info(`Creating branch: ${branchName}`);
    this.exec(`git checkout -b ${branchName}`);
  }

  /**
   * Switch to branch
   */
  checkoutBranch(branchName) {
    this.exec(`git checkout ${branchName}`);
  }

  /**
   * Stage file
   */
  stageFile(filePath) {
    this.exec(`git add "${filePath}"`);
  }

  /**
   * Commit staged changes
   */
  commit(message) {
    this.exec(`git commit -m "${message.replace(/"/g, '\\"')}"`);
  }

  /**
   * Push branch to remote
   */
  push(branchName, force = false) {
    const forceFlag = force ? '--force' : '';
    core.info(`Pushing branch: ${branchName}`);
    this.exec(`git push origin ${branchName} ${forceFlag}`.trim());
  }

  /**
   * Check if branch exists on remote
   */
  remoteBranchExists(branchName) {
    try {
      this.exec(`git ls-remote --heads origin ${branchName}`);
      return true;
    } catch (error) {
      return false;
    }
  }
}

