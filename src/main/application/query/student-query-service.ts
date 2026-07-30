import type { DBAdapter } from '../../db/interface'
import type {
  GetStudentResult,
  StudentListParams,
  StudentListResult
} from '../../../shared/types/student'
import {
  getStudent,
  listStudents
} from '../services/student-service'

export function getStudentQuery(
  db: DBAdapter,
  params: { callerUserId: string; callerRole: string; studentId: string }
): GetStudentResult {
  return getStudent(db, params)
}

export function listStudentsQuery(db: DBAdapter, params: StudentListParams): StudentListResult {
  return listStudents(db, params)
}
