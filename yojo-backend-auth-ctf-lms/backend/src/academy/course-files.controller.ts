import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiProperty, ApiPropertyOptional, ApiTags, IntersectionType } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { CurrentSession, Roles } from '../common/decorators/auth.decorators';
import type { AppRequest } from '../common/http/request-context';
import { metaOf } from '../identity/http';
import { CONTENT_KINDS, MAX_UPLOAD_BYTES, type ContentKind } from '../storage/content-rules';
import { CourseFilesService } from './course-files.service';
import { OptionalReasonDto } from './courses.dto';
import type { Pending } from './courses-trainer.service';

type Session = NonNullable<AppRequest['session']>;
const actorOf = (s: Session, req: AppRequest) => ({ userId: s.userId, ...metaOf(req) });

class UploadFieldsDto {
  @ApiProperty({ enum: CONTENT_KINDS }) @IsIn(CONTENT_KINDS) kind!: ContentKind;
  @ApiPropertyOptional({ description: 'Path inside an uploaded folder, e.g. "week1/notes.pdf"' })
  @IsOptional()
  @IsString()
  @MaxLength(600)
  relPath?: string;
}
class UploadDto extends IntersectionType(UploadFieldsDto, OptionalReasonDto) {}

/** The part of a multer file this route uses (memory storage, so the bytes are in `buffer`). */
type UploadedBlob = { originalname: string; mimetype: string; size: number; buffer: Buffer };

const INLINE = new Set(['video', 'image', 'cover']);

@ApiTags('trainer: courses')
@Controller('trainer')
@Roles('trainer')
export class TrainerCourseFilesController {
  constructor(private readonly files: CourseFilesService) {}

  @Get('courses/:id/files')
  list(@Param('id', new ParseUUIDPipe()) id: string, @CurrentSession() s: Session) {
    return this.files.list(s.userId, id);
  }

  /** One file per request (so the console can show per-file progress); folders are sent file by file. */
  @Post('courses/:id/files')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      // no storage option: multer keeps the file in memory (buffer); the per-type size limit is checked after
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 8, fieldSize: 4096 },
      defParamCharset: 'utf8',
    }),
  )
  async upload(
    @Param('id', new ParseUUIDPipe()) id: string,
    @UploadedFile() file: UploadedBlob | undefined,
    @Body() dto: UploadDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { kind, relPath, ...reason } = dto;
    const r = await this.files.upload(actorOf(s, req), id, kind, file, relPath, reason);
    if ((r as Pending)?.pending) res.status(202);
    return r;
  }

  @Delete('files/:id')
  async remove(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() why: OptionalReasonDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.files.remove(actorOf(s, req), id, why);
    res.status(r ? 202 : 204);
    return r ?? undefined;
  }
}

/** Uploaded course files, for signed-in users who may see them (checked per file in CourseFilesService.open). */
@ApiTags('courses')
@Controller('files')
@Roles('student', 'trainer', 'admin')
export class FilesController {
  constructor(private readonly files: CourseFilesService) {}

  @Get(':id')
  @HttpCode(200)
  async get(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentSession() s: Session,
    @Res({ passthrough: true }) res: Response,
  ) {
    const f = await this.files.open({ userId: s.userId, role: s.role }, id);
    const name = encodeURIComponent(f.name);
    res.set({
      'Content-Type': f.mime,
      'Content-Length': String(f.size),
      'Content-Disposition': `${INLINE.has(f.kind) || f.mime === 'application/pdf' ? 'inline' : 'attachment'}; filename*=UTF-8''${name}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, max-age=300',
      // the console pages run on another localhost port in development (same site)
      'Cross-Origin-Resource-Policy': 'same-site',
    });
    return new StreamableFile(f.stream);
  }
}
