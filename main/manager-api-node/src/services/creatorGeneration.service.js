/**
 * Creator Generation Service
 *
 * Runs content-poc generation in a background process and stores the outputs
 * as reviewable draft artifacts under storage/creator-content/<id>/generated.
 */

const fs = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');

const { prisma } = require('../config/database');
const logger = require('../utils/logger');

const STORAGE_ROOT = path.resolve(__dirname, '../../storage/creator-content');
const BACKEND_ROOT = path.resolve(__dirname, '../..');
const CONTENT_POC_ROOT = path.resolve(__dirname, '../../../../content-poc');
const GENERATION_SCRIPT = path.join(CONTENT_POC_ROOT, 'portal_generate.py');

const DEFAULT_MODE_BY_TYPE = {
  music: 'Song/Rhyme',
  story: 'Story Cards',
  rfidcontent: 'Learning'
};

const mapSubmission = (submission) => {
  if (!submission) return null;

  return {
    ...submission,
    creatorId: submission.creator_id,
    reviewerId: submission.reviewer_id,
    contentType: submission.content_type,
    sourceType: submission.source_type,
    reviewNotes: submission.review_notes,
    awsUploadedAt: submission.aws_uploaded_at,
    publishedRefType: submission.published_ref_type,
    publishedRefId: submission.published_ref_id,
    createdAt: submission.created_at,
    updatedAt: submission.updated_at
  };
};

const mapJob = (job) => {
  if (!job) return null;

  return {
    ...job,
    creatorContentId: job.creator_content_id,
    requestedBy: job.requested_by,
    jobStatus: job.job_status,
    generationMode: job.generation_mode,
    jobPayload: job.job_payload,
    resultSummary: job.result_summary,
    errorMessage: job.error_message,
    startedAt: job.started_at,
    completedAt: job.completed_at,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    submission: mapSubmission(job.creator_content)
  };
};

const ensureDir = async (dirPath) => {
  await fs.mkdir(dirPath, { recursive: true });
};

const getGenerationDir = (contentId) => path.join(STORAGE_ROOT, String(contentId), 'generated');

const getRelativeStoragePath = (absolutePath) =>
  path.relative(BACKEND_ROOT, absolutePath).replace(/\\/g, '/');

const resolveImagePreviewPath = async (outputDir, stepNumber) => {
  const candidates = [
    `step_${stepNumber}_image_pixel.png`,
    `step_${stepNumber}_image.png`,
    `step_${stepNumber}_image_pixel.jpg`,
    `step_${stepNumber}_image.jpg`,
    `step_${stepNumber}_image_pixel.jpeg`,
    `step_${stepNumber}_image.jpeg`
  ];

  for (const filename of candidates) {
    const filePath = path.join(outputDir, filename);
    try {
      await fs.access(filePath);
      return filePath;
    } catch {
      // ignore and keep searching
    }
  }

  return null;
};

const resolveAudioPath = async (outputDir, stepNumber) => {
  const candidates = [
    `step_${stepNumber}_audio.mp3`,
    `step_${stepNumber}_audio.wav`
  ];

  for (const filename of candidates) {
    const filePath = path.join(outputDir, filename);
    try {
      await fs.access(filePath);
      return filePath;
    } catch {
      // ignore and keep searching
    }
  }

  return null;
};

const loadGeneratedPlan = async (outputDir) => {
  const planPath = path.join(outputDir, 'plan.json');
  const raw = await fs.readFile(planPath, 'utf8');
  return JSON.parse(raw);
};

const collectGeneratedItems = async (outputDir) => {
  const planItems = await loadGeneratedPlan(outputDir);

  const items = await Promise.all((planItems || []).map(async (item, index) => {
    const stepNumber = item.step || index + 1;
    const audioPath = await resolveAudioPath(outputDir, stepNumber);
    const imagePath = await resolveImagePreviewPath(outputDir, stepNumber);

    return {
      step: stepNumber,
      title: item.scene || item.title || `Step ${stepNumber}`,
      text: item.text || '',
      soundEffect: item.sound_effect || '',
      imagePrompt: item.image_prompt || '',
      audioPath: audioPath ? getRelativeStoragePath(audioPath) : null,
      imagePath: imagePath ? getRelativeStoragePath(imagePath) : null
    };
  }));

  return items;
};

const runGenerationJob = async (jobId) => {
  const job = await prisma.generation_job.findUnique({
    where: { id: BigInt(jobId) },
    include: {
      creator_content: true
    }
  });

  if (!job) {
    throw new Error(`Generation job ${jobId} not found`);
  }

  const outputDir = getGenerationDir(job.creator_content_id);
  await ensureDir(outputDir);

  await prisma.generation_job.update({
    where: { id: job.id },
    data: {
      job_status: 'running',
      started_at: new Date(),
      updated_at: new Date()
    }
  });

  await prisma.creator_content.update({
    where: { id: job.creator_content_id },
    data: {
      status: 'generating',
      updated_at: new Date()
    }
  });

  const payload = job.job_payload || {};
  const args = [
    GENERATION_SCRIPT,
    '--topic', String(job.topic),
    '--content-type', String(job.creator_content.content_type),
    '--generation-mode', String(job.generation_mode || DEFAULT_MODE_BY_TYPE[job.creator_content.content_type] || 'Story Cards'),
    '--language', String(job.language || payload.language || 'en'),
    '--output-dir', outputDir,
    '--step-count', String(payload.stepCount || 10)
  ];

  if (payload.description) {
    args.push('--description', String(payload.description));
  }

  if (payload.esp32Mode) {
    args.push('--esp32-mode');
  }

  const stdout = [];
  const stderr = [];

  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(payload.pythonCommand || 'python', args, {
      cwd: CONTENT_POC_ROOT,
      windowsHide: true
    });

    child.stdout.on('data', (data) => stdout.push(data.toString()));
    child.stderr.on('data', (data) => stderr.push(data.toString()));
    child.on('error', reject);
    child.on('close', resolve);
  });

  if (exitCode !== 0) {
    const errorText = stderr.join('').trim() || stdout.join('').trim() || `Generator exited with code ${exitCode}`;

    await prisma.generation_job.update({
      where: { id: job.id },
      data: {
        job_status: 'failed',
        error_message: errorText,
        result_summary: {
          stdout: stdout.join(''),
          stderr: stderr.join('')
        },
        completed_at: new Date(),
        updated_at: new Date()
      }
    });

    await prisma.creator_content.update({
      where: { id: job.creator_content_id },
      data: {
        status: 'failed',
        review_notes: errorText,
        updated_at: new Date()
      }
    });

    throw new Error(errorText);
  }

  const generatedItems = await collectGeneratedItems(outputDir);
  const generatedSummary = {
    itemCount: generatedItems.length,
    readyAudioCount: generatedItems.filter((item) => item.audioPath).length,
    readyImageCount: generatedItems.filter((item) => item.imagePath).length,
    outputDir: getRelativeStoragePath(outputDir)
  };

  const existingMetadata = job.creator_content.metadata || {};

  await prisma.generation_job.update({
    where: { id: job.id },
    data: {
      job_status: 'succeeded',
      result_summary: generatedSummary,
      error_message: null,
      completed_at: new Date(),
      updated_at: new Date()
    }
  });

  await prisma.creator_content.update({
    where: { id: job.creator_content_id },
    data: {
      status: 'draft',
      review_notes: null,
      metadata: {
        ...existingMetadata,
        generatedTopic: job.topic,
        generationMode: job.generation_mode || DEFAULT_MODE_BY_TYPE[job.creator_content.content_type] || 'Story Cards',
        generatedOutputDir: generatedSummary.outputDir,
        generatedItems,
        generatedSummary,
        latestGenerationJobId: String(job.id)
      },
      updated_at: new Date()
    }
  });
};

const startGenerationJob = async (userId, payload) => {
  const submission = await prisma.creator_content.create({
    data: {
      title: payload.title,
      description: payload.description || null,
      content_type: payload.contentType || 'story',
      source_type: 'generated',
      language: payload.language || 'en',
      category: payload.category || null,
      status: 'generating',
      creator_id: BigInt(userId),
      metadata: {
        generatedTopic: payload.topic,
        generationMode: payload.generationMode || DEFAULT_MODE_BY_TYPE[payload.contentType] || 'Story Cards',
        ...(payload.anonymousSessionId ? { anonymousSessionId: payload.anonymousSessionId } : {})
      }
    }
  });

  const job = await prisma.generation_job.create({
    data: {
      creator_content_id: submission.id,
      topic: payload.topic,
      requested_by: BigInt(userId),
      job_status: 'queued',
      generation_mode: payload.generationMode || DEFAULT_MODE_BY_TYPE[payload.contentType] || 'Story Cards',
      language: payload.language || 'en',
      job_payload: {
        description: payload.description || null,
        stepCount: payload.stepCount || 10,
        esp32Mode: payload.esp32Mode !== false
      }
    },
    include: {
      creator_content: true
    }
  });

  setTimeout(() => {
    runGenerationJob(job.id).catch((error) => {
      logger.error('Creator generation job failed', {
        jobId: String(job.id),
        error: error.message
      });
    });
  }, 0);

  return {
    submission: mapSubmission(submission),
    job: mapJob(job)
  };
};

const getGenerationJob = async (jobId, userId, { allowReviewer = false, anonymousSessionId } = {}) => {
  const job = await prisma.generation_job.findUnique({
    where: { id: BigInt(jobId) },
    include: {
      creator_content: true
    }
  });

  if (!job) {
    throw new Error('Generation job not found');
  }

  const isUserOwner = userId && job.creator_content.creator_id === BigInt(userId);
  const isSessionOwner = anonymousSessionId &&
    job.creator_content.metadata?.anonymousSessionId === anonymousSessionId;

  if (!allowReviewer && !isUserOwner && !isSessionOwner) {
    throw new Error('You do not have access to this generation job');
  }

  return mapJob(job);
};

const retryGenerationJob = async (jobId, userId, { anonymousSessionId } = {}) => {
  const existingJob = await prisma.generation_job.findUnique({
    where: { id: BigInt(jobId) },
    include: {
      creator_content: true
    }
  });

  if (!existingJob) {
    throw new Error('Generation job not found');
  }

  const isUserOwner = userId && existingJob.creator_content.creator_id === BigInt(userId);
  const isSessionOwner = anonymousSessionId &&
    existingJob.creator_content.metadata?.anonymousSessionId === anonymousSessionId;

  if (!isUserOwner && !isSessionOwner) {
    throw new Error('You do not have access to retry this job');
  }

  const nextJob = await prisma.generation_job.create({
    data: {
      creator_content_id: existingJob.creator_content_id,
      topic: existingJob.topic,
      requested_by: BigInt(userId),
      job_status: 'queued',
      generation_mode: existingJob.generation_mode,
      language: existingJob.language,
      job_payload: existingJob.job_payload || {}
    },
    include: {
      creator_content: true
    }
  });

  await prisma.creator_content.update({
    where: { id: existingJob.creator_content_id },
    data: {
      status: 'generating',
      review_notes: null,
      updated_at: new Date()
    }
  });

  setTimeout(() => {
    runGenerationJob(nextJob.id).catch((error) => {
      logger.error('Retried creator generation job failed', {
        jobId: String(nextJob.id),
        error: error.message
      });
    });
  }, 0);

  return mapJob(nextJob);
};

module.exports = {
  startGenerationJob,
  getGenerationJob,
  retryGenerationJob
};
