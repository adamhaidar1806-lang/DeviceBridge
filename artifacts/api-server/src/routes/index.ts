import { Router, type IRouter } from "express";
import healthRouter from "./health";
import deviceBridgeRouter from "./devicebridge";
import pythonRouter from "./python";

const router: IRouter = Router();

router.use(healthRouter);
router.use(pythonRouter);
router.use(deviceBridgeRouter);

export default router;
