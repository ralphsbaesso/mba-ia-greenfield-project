import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { FindManyOptions, FindOperator } from 'typeorm';
import { StorageService } from '../../storage/storage.service';
import { Video, VideoStatus } from '../entities/video.entity';
import { ORPHAN_DRAFT_MAX_AGE_MS } from './orphan-draft-cleanup.constants';
import { OrphanDraftCleanupService } from './orphan-draft-cleanup.service';

type VideoWhere = {
  status: VideoStatus;
  upload_id: FindOperator<string>;
  created_at: FindOperator<Date>;
};

const staleDraft = (id: string): Video =>
  ({
    id,
    storage_key: `videos/${id}.mp4`,
    upload_id: `upload-${id}`,
    status: VideoStatus.DRAFT,
  }) as Video;

describe('OrphanDraftCleanupService', () => {
  let service: OrphanDraftCleanupService;
  let videos: { find: jest.Mock; update: jest.Mock };
  let storage: { abortMultipartUpload: jest.Mock };

  beforeEach(async () => {
    videos = { find: jest.fn().mockResolvedValue([]), update: jest.fn() };
    storage = { abortMultipartUpload: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrphanDraftCleanupService,
        { provide: getRepositoryToken(Video), useValue: videos },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();

    service = module.get(OrphanDraftCleanupService);
  });

  const whereOf = (): VideoWhere => {
    const calls = videos.find.mock.calls as [FindManyOptions<Video>][];

    return calls[0][0].where as VideoWhere;
  };

  describe('the selection', () => {
    it('should only ever look at drafts', async () => {
      await service.cleanupOrphanDrafts();

      // Any other state either has no multipart upload open or has one that is
      // already consolidated — aborting there would destroy a real video.
      expect(whereOf().status).toBe(VideoStatus.DRAFT);
    });

    it('should cut off at 24h before now', async () => {
      const before = Date.now();
      await service.cleanupOrphanDrafts();
      const after = Date.now();

      const cutoff = whereOf().created_at;
      expect(cutoff.type).toBe('lessThan');
      expect(cutoff.value.getTime()).toBeGreaterThanOrEqual(
        before - ORPHAN_DRAFT_MAX_AGE_MS,
      );
      expect(cutoff.value.getTime()).toBeLessThanOrEqual(
        after - ORPHAN_DRAFT_MAX_AGE_MS,
      );
    });

    it('should be a 24h threshold, not a shorter one', async () => {
      await service.cleanupOrphanDrafts();

      const elapsedSinceCutoff =
        Date.now() - whereOf().created_at.value.getTime();
      // A draft that has been running for 23h is a slow upload, not an orphan.
      expect(elapsedSinceCutoff).toBeGreaterThan(23 * 60 * 60 * 1000);
      expect(elapsedSinceCutoff).toBeLessThan(25 * 60 * 60 * 1000);
    });

    it('should skip drafts whose upload was already aborted', async () => {
      await service.cleanupOrphanDrafts();

      // Without this filter every run would re-abort the same uploads and log a
      // `NoSuchUpload` failure forever.
      expect(whereOf().upload_id.type).toBe('not');
    });

    it('should touch nothing when no draft qualifies', async () => {
      const result = await service.cleanupOrphanDrafts();

      expect(storage.abortMultipartUpload).not.toHaveBeenCalled();
      expect(videos.update).not.toHaveBeenCalled();
      expect(result).toEqual({ scanned: 0, aborted: 0, failed: 0 });
    });
  });

  describe('the abort', () => {
    it('should abort each stale upload with its own key and upload id', async () => {
      videos.find.mockResolvedValue([staleDraft('a'), staleDraft('b')]);

      const result = await service.cleanupOrphanDrafts();

      expect(storage.abortMultipartUpload).toHaveBeenCalledWith(
        'videos/a.mp4',
        'upload-a',
      );
      expect(storage.abortMultipartUpload).toHaveBeenCalledWith(
        'videos/b.mp4',
        'upload-b',
      );
      expect(result).toEqual({ scanned: 2, aborted: 2, failed: 0 });
    });

    it('should keep the row and only drop the spent grant', async () => {
      videos.find.mockResolvedValue([staleDraft('a')]);

      await service.cleanupOrphanDrafts();

      // Fase 04 owns draft management; this routine owns storage (TD-15).
      expect(videos.update).toHaveBeenCalledWith(
        { id: 'a' },
        { upload_id: null },
      );
      expect(videos.update).toHaveBeenCalledTimes(1);
    });

    it('should keep going after a failure instead of losing the batch', async () => {
      videos.find.mockResolvedValue([
        staleDraft('a'),
        staleDraft('b'),
        staleDraft('c'),
      ]);
      storage.abortMultipartUpload.mockRejectedValueOnce(
        new Error('storage unreachable'),
      );

      const result = await service.cleanupOrphanDrafts();

      expect(storage.abortMultipartUpload).toHaveBeenCalledTimes(3);
      expect(result).toEqual({ scanned: 3, aborted: 2, failed: 1 });
    });

    it('should leave the failed video reclaimable by the next run', async () => {
      videos.find.mockResolvedValue([staleDraft('a')]);
      storage.abortMultipartUpload.mockRejectedValue(new Error('boom'));

      await service.cleanupOrphanDrafts();

      // Clearing `upload_id` here would drop the only handle to those parts.
      expect(videos.update).not.toHaveBeenCalled();
    });
  });
});
